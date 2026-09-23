// Eine verbundene Chat-Sitzung: DataChannel → Verschlüsselungsschicht → Protokoll.
// Alles Eingehende ist untrusted: Größenlimits, Schema-Prüfung und Ratenbegrenzung.

import { SecureChannel, HandshakeError, type EstablishedInfo } from '../crypto/secure-channel';
import type { DecodedChunk } from '../files/chunking';
import { encodeChunk } from '../files/chunking';
import { decodeFrame, encodeMessageFrame } from '../protocol/frames';
import { createMessage, parseMessage, type Message, MAX_JSON_BYTES } from '../protocol/messages';
import { createRateLimits } from '../protocol/rate-limit';
import type { Peer, PeerState } from '../rtc/peer';
import { debug } from '../util/log';

export const HANDSHAKE_TIMEOUT_MS = 15_000;
/** Größter zulässiger verschlüsselter Frame (JSON-Limit + Overhead). */
export const MAX_ENCRYPTED_FRAME = MAX_JSON_BYTES + 256;
export const BUFFER_HIGH_WATER = 4 * 1024 * 1024;
export const BUFFER_LOW_WATER = 1024 * 1024;

export type EndReason = 'bye' | 'closed' | 'failed' | 'protocol' | 'handshake-timeout' | 'local';

export interface SessionEvents {
  /** Handshake + Schlüsselbestätigung abgeschlossen. */
  onSecure(info: EstablishedInfo): void;
  onMessage(message: Message): void;
  onChunk(chunk: DecodedChunk): void;
  onState(state: PeerState): void;
  onEnd(reason: EndReason): void;
}

export class Session {
  private readonly secure: SecureChannel;
  private rx: Promise<void> = Promise.resolve();
  private finalFrame: Uint8Array | null = null;
  private peerReady = false;
  private info: EstablishedInfo | null = null;
  private ended = false;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly limits = createRateLimits();
  private drainWaiters: (() => void)[] = [];

  constructor(
    readonly peer: Peer,
    private readonly events: SessionEvents,
  ) {
    this.secure = new SecureChannel({
      role: peer.role,
      transmit: (frame) => peer.send(frame),
      localFingerprint: peer.localFingerprint(),
      remoteFingerprint: peer.remoteFingerprint(),
    });
    peer.channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    peer.channel.addEventListener('bufferedamountlow', () => this.flushDrainWaiters());
    peer.setHandlers({
      onMessage: (data) => this.enqueue(new Uint8Array(data)),
      onState: (state) => this.events.onState(state),
      // Nach der Empfangskette, damit ein zuvor empfangenes bye noch verarbeitet wird.
      onClose: () => {
        this.rx = this.rx.then(() => this.end('closed'));
      },
      onOpen: () => undefined,
    });
  }

  /** Startet den Handshake; der Kanal muss offen sein. */
  start(): void {
    this.handshakeTimer = setTimeout(() => {
      if (!this.peerReady) this.end('handshake-timeout');
    }, HANDSHAKE_TIMEOUT_MS);
    // Der Start läuft in der Empfangskette, damit eingehende Handshakes erst danach verarbeitet werden.
    this.rx = this.rx.then(() => this.secure.start()).catch(() => this.end('protocol'));
  }

  get isSecure(): boolean {
    return this.peerReady && !this.ended;
  }

  get establishedInfo(): EstablishedInfo | null {
    return this.info;
  }

  private enqueue(frame: Uint8Array): void {
    if (this.ended) return;
    if (frame.length > MAX_ENCRYPTED_FRAME) {
      debug('Frame zu groß, verworfen');
      return;
    }
    this.rx = this.rx.then(() => this.handleFrame(frame)).catch((e) => {
      debug('Protokollfehler', e instanceof Error ? e.name : 'unbekannt');
      this.end('protocol');
    });
  }

  private async handleFrame(frame: Uint8Array): Promise<void> {
    if (this.ended) return;
    const result = await this.secure.receive(frame);
    if (result.kind === 'dropped') {
      debug('Frame verworfen:', result.reason);
      return;
    }
    if (result.kind === 'handshake-done') {
      this.info = result.info;
      // Abschlussnachricht vorab verschlüsseln, damit "bye" bei pagehide synchron gesendet werden kann.
      this.finalFrame = await this.secure.prepareFinal(encodeMessageFrame(createMessage({ type: 'bye' })));
      await this.secure.send(encodeMessageFrame(createMessage({ type: 'ready' })));
      return;
    }
    const decoded = decodeFrame(result.plaintext);
    if (!decoded) return;
    if (decoded.kind === 'chunk') {
      if (!this.peerReady) throw new HandshakeError('Chunk vor Bestätigung');
      this.events.onChunk(decoded.chunk);
      return;
    }
    const parsed = parseMessage(decoded.value);
    if (!parsed.ok) {
      debug('Nachricht ignoriert:', parsed.reason);
      return;
    }
    const msg = parsed.message;
    if (!this.peerReady) {
      // Die erste verschlüsselte Nachricht muss die Schlüsselbestätigung sein.
      if (msg.type !== 'ready') throw new HandshakeError('Erwartete Bestätigung');
      this.peerReady = true;
      clearTimeout(this.handshakeTimer);
      this.events.onSecure(this.info!);
      return;
    }
    switch (msg.type) {
      case 'ready':
        return; // doppelt – ignorieren
      case 'bye':
        this.end('bye');
        return;
      case 'text':
        if (!this.limits.text.take()) return debug('Ratenlimit Text');
        break;
      default:
        if (!this.limits.control.take()) return debug('Ratenlimit Steuerung');
    }
    this.events.onMessage(msg);
  }

  async send(message: Message): Promise<void> {
    if (!this.isSecure) throw new Error('Nicht verbunden');
    await this.secure.send(encodeMessageFrame(message));
  }

  async sendChunk(fileId: string, index: number, data: Uint8Array): Promise<void> {
    if (!this.isSecure) throw new Error('Nicht verbunden');
    await this.secure.send(encodeChunk(fileId, index, data));
  }

  /** Backpressure: wartet, bis der Sendepuffer unter die Schwelle gefallen ist. */
  waitForDrain(): Promise<void> {
    if (this.ended) return Promise.reject(new Error('Sitzung beendet'));
    if (this.peer.bufferedAmount <= BUFFER_HIGH_WATER) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  private flushDrainWaiters(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const w of waiters) w();
  }

  /** Sendet "bye" synchron (vorab verschlüsselt) – auch aus pagehide heraus. */
  sendByeNow(): void {
    if (!this.finalFrame || this.ended) return;
    try {
      this.peer.send(this.finalFrame);
    } catch {
      /* Kanal bereits zu */
    }
  }

  /** Beendet die Sitzung lokal (sendet bye, schließt die Verbindung). */
  close(): void {
    this.sendByeNow();
    this.end('local');
  }

  /** Beendet die Sitzung ohne bye (z. B. nach Verbindungsverlust). */
  abort(reason: EndReason): void {
    this.end(reason);
  }

  private end(reason: EndReason): void {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.handshakeTimer);
    this.flushDrainWaiters();
    // Kurz verzögert schließen, damit ein gerade gesendetes bye noch rausgeht.
    const peer = this.peer;
    if (reason === 'local') setTimeout(() => peer.close(), 100);
    else peer.close();
    this.events.onEnd(reason);
  }
}
