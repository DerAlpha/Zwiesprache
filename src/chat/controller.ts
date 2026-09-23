// App-Zustand und Abläufe: Verbindungsassistent (Host/Gast), Chat, Dateien, Reconnect.
// Die UI liest nur `state` und ruft Aktionen auf; alle Seiteneffekte passieren hier.

import { t } from '../i18n/de';
import { IncomingTransfer, OutgoingTransfer, sha256Hex } from '../files/transfer';
import { detectPreviewImage } from '../files/magic';
import type { DecodedChunk } from '../files/chunking';
import {
  createMessage,
  MAX_FILE_SIZE,
  MAX_TEXT_LENGTH,
  newMessageId,
  sanitizeFileName,
  type Message,
} from '../protocol/messages';
import { AnswerAlreadyUsedError, Peer, type PeerState, type Role } from '../rtc/peer';
import { getConnectionType, type ConnectionType } from '../rtc/stats';
import { buildRtcConfiguration, loadSettings, saveSettings, type Settings } from '../settings/settings';
import { CodecError, encodeSignal, newSessionId, type SignalPayload } from '../signaling/codec';
import { handOverAnswer, listenForAnswers } from '../signaling/handover';
import { buildLink, consumeFragment, decodeInput, parseInput } from '../signaling/links';
import { debug } from '../util/log';
import { Session, type EndReason } from './session';

export const DISCONNECT_GRACE_MS = 15_000;
export const HOST_WAIT_HINT_MS = 10 * 60 * 1000;
/** Browser melden ICE-"failed" teils erst nach Minuten – danach zeigen wir die Hilfe trotzdem. */
export const CONNECT_TIMEOUT_MS = 30_000;
export const GUEST_SLOW_MS = 90_000;
const TYPING_SEND_INTERVAL_MS = 3000;
const TYPING_IDLE_MS = 5000;
const PEER_TYPING_TIMEOUT_MS = 6000;
const STATS_INTERVAL_MS = 5000;
const PROGRESS_THROTTLE_MS = 150;
const MAX_PARALLEL_TRANSFERS = 3;

export type Screen =
  | { name: 'start' }
  | { name: 'paste'; reconnect: boolean; error: string | null; info: string | null }
  | { name: 'setup' }
  | { name: 'handover'; status: 'searching' | 'done' | 'not-found'; code: string }
  | { name: 'chat' }
  | { name: 'settings' }
  | { name: 'security' }
  | { name: 'fatal'; message: string };

export type SetupPhase = 'creating' | 'waiting' | 'connecting' | 'securing' | 'error';

export interface SetupState {
  role: Role;
  sessionId: string;
  phase: SetupPhase;
  link: string | null;
  code: string | null;
  startedAt: number;
  error: string | null;
  iceFailed: boolean;
  reconnect: boolean;
  answerSubmitted: boolean;
}

export type ChatStatus = 'connected' | 'reconnecting' | 'lost' | 'ended';

export type FileState = 'preparing' | 'transferring' | 'verifying' | 'done' | 'cancelled' | 'failed';

export interface FileInfo {
  name: string;
  size: number;
  state: FileState;
  transferred: number;
  /** Nur für per Magic Bytes erkannte Bilder (PNG/JPEG/GIF/WebP). */
  previewUrl: string | null;
  blob: Blob | null;
  error: string | null;
}

export interface ChatItem {
  id: string;
  kind: 'text' | 'file' | 'system';
  direction: 'in' | 'out' | 'none';
  ts: number;
  body: string;
  status: 'sending' | 'sent' | 'delivered' | 'failed' | null;
  file: FileInfo | null;
}

export interface ChatState {
  items: ChatItem[];
  status: ChatStatus;
  connectionType: ConnectionType | null;
  safetyCode: string | null;
  verified: boolean;
  peerTyping: boolean;
}

export interface AppState {
  screen: Screen;
  /** Rückkehrziel für Einstellungen / Sicherheitsseite. */
  returnTo: Screen | null;
  settings: Settings;
  setup: SetupState | null;
  chat: ChatState | null;
  unread: number;
}

export function codecErrorMessage(e: unknown): string {
  if (e instanceof CodecError) {
    switch (e.reason) {
      case 'empty':
        return t.errors.codeEmpty;
      case 'too-long':
      case 'too-large':
        return t.errors.codeTooLong;
      case 'format':
        return t.errors.codeFormat;
      case 'version':
        return t.errors.codeVersion;
      default:
        return t.errors.codeDamaged;
    }
  }
  return t.errors.generic;
}

export function checkBrowserSupport(): string | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return t.errors.insecureContext;
  if (
    typeof RTCPeerConnection !== 'function' ||
    typeof crypto === 'undefined' ||
    !crypto.subtle ||
    typeof CompressionStream !== 'function' ||
    typeof DecompressionStream !== 'function'
  ) {
    return t.errors.rtcUnsupported;
  }
  return null;
}

function safeMime(type: string): string {
  const lower = type.toLowerCase();
  return /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/.test(lower) ? lower : 'application/octet-stream';
}

export class Controller {
  state: AppState;
  private listeners = new Set<() => void>();
  private setupPeer: Peer | null = null;
  private session: Session | null = null;
  private certificate: Promise<RTCCertificate> | null = null;
  private stopHandover: (() => void) | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private peerTypingTimer: ReturnType<typeof setTimeout> | undefined;
  private typingIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTypingSent = 0;
  private outgoing = new Map<string, OutgoingTransfer>();
  private incoming = new Map<string, IncomingTransfer>();
  private progressFlush: ReturnType<typeof setTimeout> | undefined;
  private pendingProgress = new Map<string, number>();
  /** Fingerprint-Paar der zuletzt verifizierten Verbindung (für Reconnects mit denselben Geräten). */
  private verifiedPair: string | null = null;
  private currentPair: string | null = null;
  onIncomingMessage: (() => void) | null = null;

  constructor() {
    this.state = {
      screen: { name: 'start' },
      returnTo: null,
      settings: loadSettings(),
      setup: null,
      chat: null,
      unread: 0,
    };
  }

  // ---------------------------------------------------------------- Zustand

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private patchSetup(patch: Partial<SetupState>, sessionId?: string): void {
    const setup = this.state.setup;
    if (!setup || (sessionId !== undefined && setup.sessionId !== sessionId)) return;
    this.set({ setup: { ...setup, ...patch } });
  }

  private patchChat(patch: Partial<ChatState>): void {
    if (!this.state.chat) return;
    this.set({ chat: { ...this.state.chat, ...patch } });
  }

  private addItem(item: Omit<ChatItem, 'ts'> & { ts?: number }): void {
    const chat = this.state.chat;
    if (!chat) return;
    this.set({ chat: { ...chat, items: [...chat.items, { ts: Date.now(), ...item }] } });
  }

  private addSystem(body: string): void {
    this.addItem({ id: newMessageId(), kind: 'system', direction: 'none', body, status: null, file: null });
  }

  private updateItem(id: string, fn: (item: ChatItem) => ChatItem): void {
    const chat = this.state.chat;
    if (!chat) return;
    let changed = false;
    const items = chat.items.map((it) => {
      if (it.id !== id) return it;
      changed = true;
      return fn(it);
    });
    if (changed) this.set({ chat: { ...chat, items } });
  }

  private updateFile(id: string, patch: Partial<FileInfo>, status?: ChatItem['status']): void {
    this.updateItem(id, (it) =>
      it.file ? { ...it, file: { ...it.file, ...patch }, status: status === undefined ? it.status : status } : it,
    );
  }

  // ---------------------------------------------------------------- Navigation

  go(screen: Screen): void {
    this.set({ screen });
  }

  openOverlay(name: 'settings' | 'security'): void {
    const current = this.state.screen;
    const returnTo = current.name === 'settings' || current.name === 'security' ? this.state.returnTo : current;
    this.set({ screen: { name }, returnTo });
  }

  back(): void {
    this.set({ screen: this.state.returnTo ?? this.homeScreen(), returnTo: null });
  }

  homeScreen(): Screen {
    return this.state.chat ? { name: 'chat' } : { name: 'start' };
  }

  openPaste(reconnect = false): void {
    this.go({ name: 'paste', reconnect, error: null, info: null });
  }

  updateSettings(settings: Settings): void {
    saveSettings(settings);
    this.set({ settings });
  }

  // ---------------------------------------------------------------- Start / Fragment

  init(): void {
    const unsupported = checkBrowserSupport();
    if (unsupported) {
      this.go({ name: 'fatal', message: unsupported });
      return;
    }
    window.addEventListener('pagehide', () => this.onPageHide());
    window.addEventListener('hashchange', () => this.handleFragment());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.set({ unread: 0 });
    });
    this.handleFragment();
  }

  private handleFragment(): void {
    const fragment = consumeFragment();
    if (!fragment) return;
    const setup = this.state.setup;
    if (fragment.startsWith('a=')) {
      // Antwort im wartenden Tab selbst (z. B. in die Adresszeile eingefügt)
      if (setup && setup.role === 'host' && setup.phase === 'waiting') {
        void this.submitAnswer(fragment);
        return;
      }
      void this.handOver(fragment);
      return;
    }
    if (this.session || setup) return; // laufende Verbindung nicht überschreiben
    void this.submitPaste(fragment, this.state.chat !== null);
  }

  private async handOver(fragment: string): Promise<void> {
    const code = fragment.slice(2);
    this.go({ name: 'handover', status: 'searching', code });
    const claimed = await handOverAnswer(code);
    this.go({ name: 'handover', status: claimed ? 'done' : 'not-found', code });
  }

  // ---------------------------------------------------------------- Verbindungsaufbau

  private getCertificate(): Promise<RTCCertificate> {
    // Ein Zertifikat pro Tab: bleibt bei Reconnects gleich (Voraussetzung für übertragbare Verifizierung).
    this.certificate ??= RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' } as EcKeyGenParams);
    return this.certificate;
  }

  private async newPeer(role: Role): Promise<Peer> {
    let cert: RTCCertificate | undefined;
    try {
      cert = await this.getCertificate();
    } catch {
      cert = undefined;
    }
    return new Peer(role, buildRtcConfiguration(this.state.settings, cert));
  }

  private discardSetup(): void {
    clearTimeout(this.connectTimer);
    this.stopHandover?.();
    this.stopHandover = null;
    this.setupPeer?.close();
    this.setupPeer = null;
    this.set({ setup: null });
  }

  cancelSetup(): void {
    this.discardSetup();
    this.go(this.homeScreen());
  }

  /** Host: neue Einladung erzeugen (auch "Neuen Code erzeugen" und Reconnect). */
  async startHost(reconnect = this.state.chat !== null): Promise<void> {
    this.discardSetup();
    const sessionId = newSessionId();
    this.set({
      screen: { name: 'setup' },
      setup: {
        role: 'host',
        sessionId,
        phase: 'creating',
        link: null,
        code: null,
        startedAt: Date.now(),
        error: null,
        iceFailed: false,
        reconnect,
        answerSubmitted: false,
      },
    });
    try {
      const peer = await this.newPeer('host');
      this.setupPeer = peer;
      this.watchSetupPeer(peer, sessionId);
      const sdp = await peer.createOffer();
      if (this.setupPeer !== peer) return;
      if (!/^a=candidate:/m.test(sdp)) {
        this.patchSetup({ phase: 'error', error: t.errors.noCandidates }, sessionId);
        return;
      }
      const code = await encodeSignal({ version: 1, type: 'offer', sessionId, sdp });
      if (this.setupPeer !== peer) return;
      this.patchSetup({ phase: 'waiting', code, link: buildLink('offer', code), startedAt: Date.now() }, sessionId);
      this.stopHandover = listenForAnswers(
        (c) => this.answerMatches(c, sessionId),
        (c) => void this.submitAnswer(c),
      );
    } catch (e) {
      debug('Host-Setup fehlgeschlagen', e instanceof Error ? e.name : '');
      this.patchSetup({ phase: 'error', error: t.errors.setupFailed }, sessionId);
    }
  }

  private async answerMatches(code: string, sessionId: string): Promise<boolean> {
    const setup = this.state.setup;
    if (!setup || setup.sessionId !== sessionId || setup.role !== 'host' || setup.answerSubmitted) return false;
    try {
      const payload = await decodeInput(code);
      return payload.type === 'answer' && payload.sessionId === sessionId;
    } catch {
      return false;
    }
  }

  /** Host: Antwort (Link oder Code) einfügen. Gibt eine Fehlermeldung zurück oder null. */
  async submitAnswer(text: string): Promise<string | null> {
    const setup = this.state.setup;
    let payload: SignalPayload;
    try {
      payload = await decodeInput(text);
    } catch (e) {
      return this.setupError(codecErrorMessage(e));
    }
    if (payload.type !== 'answer') return this.setupError(t.errors.wrongTypeExpectedAnswer);
    if (!setup || setup.role !== 'host' || !this.setupPeer) return this.setupError(t.errors.invitationGone);
    if (payload.sessionId !== setup.sessionId) return this.setupError(t.errors.otherInvitation);
    if (setup.answerSubmitted) return this.setupError(t.errors.alreadyUsed);
    this.patchSetup({ answerSubmitted: true, phase: 'connecting', error: null });
    this.stopHandover?.();
    this.stopHandover = null;
    try {
      await this.setupPeer.acceptAnswer(payload.sdp);
      this.startConnectTimer(setup.sessionId, CONNECT_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof AnswerAlreadyUsedError) return this.setupError(t.errors.alreadyUsed);
      this.patchSetup({ phase: 'error', error: t.errors.setupFailed });
      return t.errors.setupFailed;
    }
    return null;
  }

  private setupError(message: string): string {
    if (this.state.setup) this.patchSetup({ error: message });
    return message;
  }

  /** Eingefügter Link/Code auf dem Einfüge-Screen: automatische Erkennung Einladung vs. Antwort. */
  async submitPaste(text: string, reconnect = false): Promise<void> {
    let payload: SignalPayload;
    try {
      payload = await decodeInput(text);
    } catch (e) {
      this.go({ name: 'paste', reconnect, error: codecErrorMessage(e), info: null });
      return;
    }
    if (payload.type === 'answer') {
      const setup = this.state.setup;
      if (setup && setup.role === 'host') {
        this.go({ name: 'setup' });
        await this.submitAnswer(text);
        return;
      }
      // Evtl. wartet ein anderer Tab in diesem Browser auf genau diese Antwort.
      const claimed = await handOverAnswer(parseInput(text).code);
      this.go({
        name: 'paste',
        reconnect,
        error: claimed ? null : t.errors.invitationGone,
        info: claimed ? t.paste.handedOver : null,
      });
      return;
    }
    await this.acceptInvitation(payload, reconnect);
  }

  /** Gast: Einladung annehmen und Antwort erzeugen. */
  async acceptInvitation(payload: SignalPayload, reconnect: boolean): Promise<void> {
    this.discardSetup();
    const sessionId = payload.sessionId;
    this.set({
      screen: { name: 'setup' },
      setup: {
        role: 'guest',
        sessionId,
        phase: 'creating',
        link: null,
        code: null,
        startedAt: Date.now(),
        error: null,
        iceFailed: false,
        reconnect,
        answerSubmitted: false,
      },
    });
    try {
      const peer = await this.newPeer('guest');
      this.setupPeer = peer;
      this.watchSetupPeer(peer, sessionId);
      const sdp = await peer.acceptOffer(payload.sdp);
      if (this.setupPeer !== peer) return;
      if (!/^a=candidate:/m.test(sdp)) {
        this.patchSetup({ phase: 'error', error: t.errors.noCandidates }, sessionId);
        return;
      }
      const code = await encodeSignal({ version: 1, type: 'answer', sessionId, sdp });
      if (this.setupPeer !== peer) return;
      // Nur weiterschalten, falls die Verbindung nicht schon steht (z. B. sehr schneller Host).
      if (this.state.setup?.phase === 'creating') {
        this.patchSetup({ phase: 'waiting', code, link: buildLink('answer', code) }, sessionId);
        this.startConnectTimer(sessionId, GUEST_SLOW_MS);
      } else {
        this.patchSetup({ code, link: buildLink('answer', code) }, sessionId);
      }
    } catch (e) {
      debug('Gast-Setup fehlgeschlagen', e instanceof Error ? e.name : '');
      this.patchSetup({ phase: 'error', error: t.errors.setupFailed }, sessionId);
    }
  }

  /** Zeigt nach `ms` ohne Verbindung die Hilfe an; die Verbindung darf trotzdem noch zustande kommen. */
  private startConnectTimer(sessionId: string, ms: number): void {
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      const setup = this.state.setup;
      if (setup && setup.sessionId === sessionId && setup.phase !== 'securing' && setup.phase !== 'error') {
        this.patchSetup({ iceFailed: true }, sessionId);
      }
    }, ms);
  }

  private watchSetupPeer(peer: Peer, sessionId: string): void {
    peer.setHandlers({
      onOpen: () => this.onChannelOpen(peer, sessionId),
      onState: (state) => {
        if (this.setupPeer !== peer) return;
        if (state === 'failed') this.patchSetup({ iceFailed: true }, sessionId);
        else if (state === 'connected') this.patchSetup({ iceFailed: false }, sessionId);
      },
    });
  }

  private onChannelOpen(peer: Peer, sessionId: string): void {
    if (this.setupPeer !== peer) return;
    clearTimeout(this.connectTimer);
    this.stopHandover?.();
    this.stopHandover = null;
    this.patchSetup({ phase: 'securing', iceFailed: false }, sessionId);
    const session = new Session(peer, {
      onSecure: (info) => this.onSecure(session, info.safetyCode, info.hostFingerprint, info.guestFingerprint),
      onMessage: (msg) => this.onMessage(session, msg),
      onChunk: (chunk) => this.onChunk(session, chunk),
      onState: (state) => this.onPeerState(session, state),
      onEnd: (reason) => this.onEnd(session, reason),
    });
    this.session = session;
    session.start();
  }

  // ---------------------------------------------------------------- Sitzung

  private onSecure(session: Session, safetyCode: string, hostFp: string, guestFp: string): void {
    if (this.session !== session) return;
    const reconnect = this.state.chat !== null;
    this.setupPeer = null;
    const pair = [hostFp, guestFp].sort().join('|');
    this.currentPair = pair;
    const carried = this.verifiedPair !== null && this.verifiedPair === pair;
    const base: ChatState = this.state.chat ?? {
      items: [],
      status: 'connected',
      connectionType: null,
      safetyCode: null,
      verified: false,
      peerTyping: false,
    };
    this.set({
      setup: null,
      screen: { name: 'chat' },
      chat: { ...base, status: 'connected', safetyCode, verified: carried, peerTyping: false, connectionType: null },
    });
    if (reconnect) {
      this.addSystem(t.chat.reconnected);
      this.addSystem(carried ? t.safety.carriedOver : t.safety.newCode);
    } else {
      this.addSystem(t.chat.connectedNote);
    }
    this.startStats(session);
  }

  private startStats(session: Session): void {
    clearInterval(this.statsTimer);
    const poll = async () => {
      if (this.session !== session) return;
      try {
        const type = await getConnectionType(session.peer.pc);
        if (type && this.state.chat && this.state.chat.connectionType !== type) this.patchChat({ connectionType: type });
      } catch {
        /* Stats nicht verfügbar */
      }
    };
    void poll();
    this.statsTimer = setInterval(poll, STATS_INTERVAL_MS);
  }

  private onPeerState(session: Session, state: PeerState): void {
    if (this.session !== session) return;
    if (!session.isSecure) {
      if (state === 'failed') this.patchSetup({ iceFailed: true });
      return;
    }
    if (state === 'connected') {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = undefined;
      if (this.state.chat?.status === 'reconnecting') this.patchChat({ status: 'connected' });
      void getConnectionType(session.peer.pc)
        .then((type) => type && this.patchChat({ connectionType: type }))
        .catch(() => undefined);
    } else if (state === 'disconnected') {
      this.patchChat({ status: 'reconnecting' });
      if (this.disconnectTimer === undefined) {
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = undefined;
          if (this.session === session) session.abort('failed');
        }, DISCONNECT_GRACE_MS);
      }
    } else if (state === 'failed') {
      session.abort('failed');
    }
  }

  private onEnd(session: Session, reason: EndReason): void {
    if (this.session !== session) return;
    this.session = null;
    clearInterval(this.statsTimer);
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
    clearTimeout(this.peerTypingTimer);
    this.failActiveTransfers();
    if (reason === 'local') return;
    if (this.state.setup) {
      // Noch im Assistenten: Handshake gescheitert
      this.patchSetup({ phase: 'error', error: t.errors.handshakeFailed });
      return;
    }
    if (reason === 'bye') {
      this.patchChat({ status: 'ended', peerTyping: false });
      this.addSystem(t.chat.peerEnded);
    } else {
      this.patchChat({ status: 'lost', peerTyping: false, connectionType: null });
      this.addSystem(t.chat.lostTitle);
    }
  }

  private failActiveTransfers(): void {
    for (const [id, tr] of this.outgoing) {
      tr.cancel();
      this.updateFile(id, { state: 'failed', error: null });
    }
    for (const [id, tr] of this.incoming) {
      tr.discard();
      this.updateFile(id, { state: 'failed', error: null });
    }
    this.outgoing.clear();
    this.incoming.clear();
  }

  private onMessage(session: Session, msg: Message): void {
    if (this.session !== session) return;
    switch (msg.type) {
      case 'text':
        this.clearPeerTyping();
        this.addItem({ id: msg.id, kind: 'text', direction: 'in', body: msg.body, status: null, file: null, ts: Date.now() });
        void session.send(createMessage({ type: 'ack', ref: msg.id })).catch(() => undefined);
        this.notifyIncoming();
        return;
      case 'ack':
        this.updateItem(msg.ref, (it) => (it.direction === 'out' ? { ...it, status: 'delivered' } : it));
        return;
      case 'typing':
        clearTimeout(this.peerTypingTimer);
        this.patchChat({ peerTyping: msg.active });
        if (msg.active) this.peerTypingTimer = setTimeout(() => this.clearPeerTyping(), PEER_TYPING_TIMEOUT_MS);
        return;
      case 'file-offer':
        this.onFileOffer(session, msg);
        return;
      case 'file-cancel':
        this.onFileCancel(msg.ref);
        return;
      default:
        return;
    }
  }

  private clearPeerTyping(): void {
    clearTimeout(this.peerTypingTimer);
    if (this.state.chat?.peerTyping) this.patchChat({ peerTyping: false });
  }

  private notifyIncoming(): void {
    if (typeof document !== 'undefined' && document.hidden) this.set({ unread: this.state.unread + 1 });
    this.onIncomingMessage?.();
  }

  // ---------------------------------------------------------------- Dateien (Empfang)

  private onFileOffer(session: Session, msg: Extract<Message, { type: 'file-offer' }>): void {
    const existing = this.state.chat?.items.some((it) => it.id === msg.id);
    if (existing || this.incoming.has(msg.id)) return;
    if (this.incoming.size >= MAX_PARALLEL_TRANSFERS) {
      void session.send(createMessage({ type: 'file-cancel', ref: msg.id })).catch(() => undefined);
      return;
    }
    const transfer = new IncomingTransfer(msg.id, msg.size, msg.sha256);
    this.incoming.set(msg.id, transfer);
    this.addItem({
      id: msg.id,
      kind: 'file',
      direction: 'in',
      body: '',
      status: null,
      file: { name: msg.name, size: msg.size, state: 'transferring', transferred: 0, previewUrl: null, blob: null, error: null },
    });
    this.notifyIncoming();
    if (transfer.isComplete) void this.finishIncoming(session, transfer);
  }

  private onChunk(session: Session, chunk: DecodedChunk): void {
    const transfer = this.incoming.get(chunk.fileId);
    if (!transfer) return; // unbekannt oder abgebrochen
    if (!transfer.add(chunk)) {
      this.incoming.delete(chunk.fileId);
      transfer.discard();
      this.updateFile(chunk.fileId, { state: 'failed', error: t.errors.generic });
      void session.send(createMessage({ type: 'file-cancel', ref: chunk.fileId })).catch(() => undefined);
      return;
    }
    this.scheduleProgress(chunk.fileId, transfer.received);
    if (transfer.isComplete) void this.finishIncoming(session, transfer);
  }

  private async finishIncoming(session: Session, transfer: IncomingTransfer): Promise<void> {
    this.flushProgressNow();
    this.updateFile(transfer.id, { state: 'verifying', transferred: transfer.size });
    const result = await transfer.finish();
    this.incoming.delete(transfer.id);
    if (!this.state.chat) return;
    if (!result) {
      this.updateFile(transfer.id, { state: 'failed', error: t.files.integrity });
      return;
    }
    const previewUrl = result.previewType ? URL.createObjectURL(result.blob) : null;
    this.updateFile(transfer.id, { state: 'done', blob: result.blob, previewUrl });
    if (this.session === session) void session.send(createMessage({ type: 'ack', ref: transfer.id })).catch(() => undefined);
  }

  private scheduleProgress(id: string, bytes: number): void {
    this.pendingProgress.set(id, bytes);
    if (this.progressFlush !== undefined) return;
    this.progressFlush = setTimeout(() => this.flushProgressNow(), PROGRESS_THROTTLE_MS);
  }

  private flushProgressNow(): void {
    clearTimeout(this.progressFlush);
    this.progressFlush = undefined;
    const pending = this.pendingProgress;
    this.pendingProgress = new Map();
    for (const [id, bytes] of pending) this.updateFile(id, { transferred: bytes });
  }

  private onFileCancel(ref: string): void {
    const out = this.outgoing.get(ref);
    if (out) {
      out.cancel();
      this.outgoing.delete(ref);
      this.updateFile(ref, { state: 'cancelled' });
      return;
    }
    const inc = this.incoming.get(ref);
    if (inc) {
      inc.discard();
      this.incoming.delete(ref);
      this.updateFile(ref, { state: 'cancelled' });
    }
  }

  // ---------------------------------------------------------------- Aktionen im Chat

  get canSend(): boolean {
    return this.session?.isSecure === true && this.state.chat?.status === 'connected';
  }

  async sendText(body: string): Promise<boolean> {
    const text = body.replace(/\s+$/u, '');
    if (text.trim().length === 0 || text.length > MAX_TEXT_LENGTH) return false;
    const session = this.session;
    if (!session?.isSecure) return false;
    const msg = createMessage({ type: 'text', body: text });
    this.addItem({ id: msg.id, kind: 'text', direction: 'out', body: text, status: 'sending', file: null });
    this.lastTypingSent = 0;
    clearTimeout(this.typingIdleTimer);
    try {
      await session.send(msg);
      this.updateItem(msg.id, (it) => (it.status === 'sending' ? { ...it, status: 'sent' } : it));
    } catch {
      this.updateItem(msg.id, (it) => ({ ...it, status: 'failed' }));
    }
    return true;
  }

  /** Vom Eingabefeld bei jeder Eingabe aufgerufen; sendet gedrosselt Tipp-Status. */
  notifyTyping(hasText: boolean): void {
    const session = this.session;
    if (!session?.isSecure) return;
    clearTimeout(this.typingIdleTimer);
    const now = Date.now();
    if (!hasText) {
      if (this.lastTypingSent !== 0) {
        this.lastTypingSent = 0;
        void session.send(createMessage({ type: 'typing', active: false })).catch(() => undefined);
      }
      return;
    }
    if (now - this.lastTypingSent > TYPING_SEND_INTERVAL_MS) {
      this.lastTypingSent = now;
      void session.send(createMessage({ type: 'typing', active: true })).catch(() => undefined);
    }
    this.typingIdleTimer = setTimeout(() => this.notifyTyping(false), TYPING_IDLE_MS);
  }

  /** Datei senden. Gibt eine Fehlermeldung zurück oder null. */
  async sendFile(file: File): Promise<string | null> {
    const session = this.session;
    if (!session?.isSecure) return t.errors.generic;
    if (file.size > MAX_FILE_SIZE) return t.files.tooLarge(MAX_FILE_SIZE / 1024 / 1024);
    if (this.outgoing.size >= MAX_PARALLEL_TRANSFERS) return t.files.tooMany;
    const id = newMessageId();
    const name = sanitizeFileName(file.name);
    this.addItem({
      id,
      kind: 'file',
      direction: 'out',
      body: '',
      status: 'sending',
      file: { name, size: file.size, state: 'preparing', transferred: 0, previewUrl: null, blob: null, error: null },
    });
    const transfer = new OutgoingTransfer(id, file);
    this.outgoing.set(id, transfer);
    try {
      const buffer = await file.arrayBuffer();
      const sha256 = await sha256Hex(buffer);
      const previewType = detectPreviewImage(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
      const previewUrl = previewType ? URL.createObjectURL(new Blob([buffer], { type: previewType })) : null;
      if (transfer.isCancelled || this.session !== session) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        return null;
      }
      this.updateFile(id, { state: 'transferring', previewUrl });
      await session.send(
        createMessage({ type: 'file-offer', id, name, size: file.size, mime: safeMime(file.type), sha256 }),
      );
      const result = await transfer.send(session, (sent) => this.scheduleProgress(id, sent));
      this.flushProgressNow();
      this.outgoing.delete(id);
      if (result === 'done') this.updateFile(id, { state: 'done', transferred: file.size }, 'sent');
    } catch (e) {
      debug('Dateiversand fehlgeschlagen', e instanceof Error ? e.name : '');
      this.outgoing.delete(id);
      this.updateFile(id, { state: 'failed' }, 'failed');
    }
    return null;
  }

  cancelFile(id: string): void {
    const session = this.session;
    const known = this.outgoing.has(id) || this.incoming.has(id);
    this.onFileCancel(id);
    if (known && session?.isSecure) void session.send(createMessage({ type: 'file-cancel', ref: id })).catch(() => undefined);
  }

  setVerified(verified: boolean): void {
    this.verifiedPair = verified ? this.currentPair : null;
    this.patchChat({ verified });
  }

  /** "Chat beenden": bye senden, Verbindung schließen, alle Daten verwerfen. */
  endChat(): void {
    const session = this.session;
    this.session = null;
    session?.close();
    this.discardSetup();
    this.discardChat();
    this.go({ name: 'start' });
  }

  private discardChat(): void {
    clearInterval(this.statsTimer);
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
    clearTimeout(this.peerTypingTimer);
    clearTimeout(this.typingIdleTimer);
    this.failActiveTransfers();
    for (const item of this.state.chat?.items ?? []) {
      if (item.file?.previewUrl) URL.revokeObjectURL(item.file.previewUrl);
    }
    this.verifiedPair = null;
    this.currentPair = null;
    this.set({ chat: null, unread: 0 });
  }

  private onPageHide(): void {
    const session = this.session;
    if (session) {
      session.sendByeNow();
      this.session = null;
      session.peer.close();
      // Falls die Seite aus dem bfcache zurückkehrt, ist die Verbindung sichtbar weg.
      this.patchChat({ status: 'lost', peerTyping: false, connectionType: null });
    }
    this.discardSetup();
  }

  /** Nur für Tests/Debugging: aktuelle Sitzung vorhanden? */
  get hasSession(): boolean {
    return this.session !== null;
  }
}

// Für Datei-Downloads aus der UI: Blob-URL erzeugen, Download auslösen, danach wieder freigeben.
export function downloadBlob(blob: Blob, name: string): void {
  const safe = new Blob([blob], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(safe);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
