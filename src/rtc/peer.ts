// RTCPeerConnection + ein ausgehandelter DataChannel, manuelles Signaling ohne Trickle ICE.

import { extractFingerprints } from '../signaling/sdp';
import { debug } from '../util/log';

export type Role = 'host' | 'guest';

export const ICE_GATHERING_TIMEOUT_MS = 5000;
/** Obergrenze für eine einzelne Kanalnachricht (Ciphertext), passt zu max-message-size aller Zielbrowser. */
export const MAX_CHANNEL_MESSAGE = 256 * 1024;

export type PeerState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

/** Wartet, bis das ICE-Gathering abgeschlossen ist – höchstens `timeoutMs`. */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = ICE_GATHERING_TIMEOUT_MS): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCandidate);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) finish();
    };
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
    timer = setTimeout(finish, timeoutMs);
  });
}

export class AnswerAlreadyUsedError extends Error {
  constructor() {
    super('Diese Einladung hat bereits eine Antwort erhalten');
    this.name = 'AnswerAlreadyUsedError';
  }
}

export interface PeerHandlers {
  onState?(state: PeerState): void;
  onOpen?(): void;
  onClose?(): void;
  onMessage?(data: ArrayBuffer): void;
}

export class Peer {
  readonly pc: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  private handlers: PeerHandlers = {};
  private closed = false;

  constructor(
    readonly role: Role,
    config: RTCConfiguration,
  ) {
    this.pc = new RTCPeerConnection(config);
    // Ausgehandelter Kanal mit fester ID: beide Seiten legen ihn identisch an, kein ondatachannel nötig.
    this.channel = this.pc.createDataChannel('zwiesprache', { negotiated: true, id: 0, ordered: true });
    this.channel.binaryType = 'arraybuffer';
    this.channel.addEventListener('open', () => this.handlers.onOpen?.());
    this.channel.addEventListener('close', () => this.handlers.onClose?.());
    this.channel.addEventListener('message', (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) this.handlers.onMessage?.(e.data);
      // Text-Frames sind im Protokoll nicht vorgesehen und werden verworfen.
    });
    const emitState = () => this.handlers.onState?.(this.state);
    this.pc.addEventListener('connectionstatechange', emitState);
    this.pc.addEventListener('iceconnectionstatechange', emitState);
  }

  setHandlers(handlers: PeerHandlers): void {
    this.handlers = handlers;
  }

  get state(): PeerState {
    if (this.closed) return 'closed';
    const cs = this.pc.connectionState as RTCPeerConnectionState | undefined;
    if (cs) return cs;
    // Fallback über den ICE-Zustand
    switch (this.pc.iceConnectionState) {
      case 'checking':
        return 'connecting';
      case 'connected':
      case 'completed':
        return 'connected';
      case 'disconnected':
        return 'disconnected';
      case 'failed':
        return 'failed';
      case 'closed':
        return 'closed';
      default:
        return 'new';
    }
  }

  /** Host: Offer erzeugen und nach dem ICE-Gathering die vollständige lokale SDP liefern. */
  async createOffer(): Promise<string> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGathering(this.pc);
    debug('offer bereit, gathering:', this.pc.iceGatheringState);
    return this.pc.localDescription!.sdp;
  }

  /** Gast: Offer übernehmen, Answer erzeugen, vollständige lokale SDP liefern. */
  async acceptOffer(sdp: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIceGathering(this.pc);
    debug('answer bereit, gathering:', this.pc.iceGatheringState);
    return this.pc.localDescription!.sdp;
  }

  /** Host: Answer übernehmen. Eine Einladung akzeptiert genau eine Antwort. */
  async acceptAnswer(sdp: string): Promise<void> {
    if (this.pc.signalingState !== 'have-local-offer') throw new AnswerAlreadyUsedError();
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  get hasRemoteDescription(): boolean {
    return this.pc.remoteDescription !== null;
  }

  localFingerprint(): string {
    return extractFingerprints(this.pc.localDescription?.sdp ?? '');
  }

  remoteFingerprint(): string {
    return extractFingerprints(this.pc.remoteDescription?.sdp ?? '');
  }

  send(data: Uint8Array): void {
    if (this.channel.readyState !== 'open') throw new Error('Kanal nicht offen');
    this.channel.send(data as Uint8Array<ArrayBuffer>);
  }

  get bufferedAmount(): number {
    return this.channel.bufferedAmount;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers = {};
    try {
      this.channel.close();
    } catch {
      /* ignorieren */
    }
    try {
      this.pc.close();
    } catch {
      /* ignorieren */
    }
  }
}
