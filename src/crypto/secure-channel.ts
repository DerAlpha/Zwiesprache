// Zusätzliche Verschlüsselungsschicht über dem (bereits DTLS-geschützten) DataChannel.
//
// Ablauf direkt nach dem Öffnen des Kanals:
//   1. Beide Seiten erzeugen ein ephemeres ECDH-P-256-Schlüsselpaar und senden den Public Key
//      im Handshake-Frame [0x00][Version][Rolle][65 Byte Public Key].
//   2. ECDH → gemeinsames Geheimnis → HKDF-SHA-256 (Salt = Transkript-Hash über Fingerprints
//      und Public Keys) → je ein AES-256-GCM-Schlüssel pro Richtung (host→gast, gast→host).
//   3. Erst danach sind Anwendungsframes erlaubt; alles läuft durch {@link SendCipher}/{@link ReceiveCipher}.

import { concatBytes, bytesEqual, toArrayBuffer, utf8Encode } from '../util/bytes';
import type { Role } from '../rtc/peer';
import { FRAME_KIND_ENCRYPTED, ReceiveCipher, SendCipher } from './cipher';
import { computeSafetyCode, lengthPrefixed } from './safety-code';

export const FRAME_KIND_HANDSHAKE = 0x00;
export const HANDSHAKE_VERSION = 1;
export const PUBLIC_KEY_LENGTH = 65;
const HANDSHAKE_LENGTH = 3 + PUBLIC_KEY_LENGTH;
const ROLE_BYTE: Record<Role, number> = { host: 1, guest: 2 };
const TRANSCRIPT_LABEL = 'Zwiesprache Transkript v1';
const INFO_HOST_TO_GUEST = 'Zwiesprache v1 host->gast';
const INFO_GUEST_TO_HOST = 'Zwiesprache v1 gast->host';

export class HandshakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandshakeError';
  }
}

export interface KeyPair {
  privateKey: CryptoKey;
  publicKey: Uint8Array;
}

export async function generateKeyPair(): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey };
}

export function encodeHandshake(role: Role, publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== PUBLIC_KEY_LENGTH) throw new HandshakeError('Public Key hat falsche Länge');
  const out = new Uint8Array(HANDSHAKE_LENGTH);
  out[0] = FRAME_KIND_HANDSHAKE;
  out[1] = HANDSHAKE_VERSION;
  out[2] = ROLE_BYTE[role];
  out.set(publicKey, 3);
  return out;
}

export function decodeHandshake(frame: Uint8Array, expectedRole: Role): Uint8Array {
  if (frame.length !== HANDSHAKE_LENGTH || frame[0] !== FRAME_KIND_HANDSHAKE) throw new HandshakeError('Format');
  if (frame[1] !== HANDSHAKE_VERSION) throw new HandshakeError('Version');
  if (frame[2] !== ROLE_BYTE[expectedRole]) throw new HandshakeError('Rolle');
  const key = frame.slice(3);
  if (key[0] !== 0x04) throw new HandshakeError('Schlüsselformat');
  return key;
}

export interface SessionKeys {
  send: SendCipher;
  receive: ReceiveCipher;
}

export interface DeriveInput {
  role: Role;
  privateKey: CryptoKey;
  hostPublicKey: Uint8Array;
  guestPublicKey: Uint8Array;
  hostFingerprint: string;
  guestFingerprint: string;
}

/** Transkript-Hash: bindet die Schlüssel an beide DTLS-Fingerprints und beide Public Keys. */
export async function transcriptHash(i: Omit<DeriveInput, 'role' | 'privateKey'>): Promise<Uint8Array> {
  const material = concatBytes(
    lengthPrefixed(utf8Encode(TRANSCRIPT_LABEL)),
    lengthPrefixed(utf8Encode(i.hostFingerprint)),
    lengthPrefixed(utf8Encode(i.guestFingerprint)),
    lengthPrefixed(i.hostPublicKey),
    lengthPrefixed(i.guestPublicKey),
  );
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(material)));
}

export async function deriveSessionKeys(input: DeriveInput): Promise<SessionKeys> {
  const peerPublic = input.role === 'host' ? input.guestPublicKey : input.hostPublicKey;
  // importKey prüft, dass der Punkt auf der Kurve liegt.
  const peerKey = await crypto.subtle.importKey('raw', toArrayBuffer(peerPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, input.privateKey, 256);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = toArrayBuffer(await transcriptHash(input));
  const derive = (info: string, usage: KeyUsage) =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: toArrayBuffer(utf8Encode(info)) },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage],
    );
  if (input.role === 'host') {
    const [send, receive] = await Promise.all([derive(INFO_HOST_TO_GUEST, 'encrypt'), derive(INFO_GUEST_TO_HOST, 'decrypt')]);
    return { send: new SendCipher(send), receive: new ReceiveCipher(receive) };
  }
  const [send, receive] = await Promise.all([derive(INFO_GUEST_TO_HOST, 'encrypt'), derive(INFO_HOST_TO_GUEST, 'decrypt')]);
  return { send: new SendCipher(send), receive: new ReceiveCipher(receive) };
}

export interface SecureChannelOptions {
  role: Role;
  /** Sendet einen Frame roh über den DataChannel. */
  transmit(frame: Uint8Array): void;
  localFingerprint: string;
  remoteFingerprint: string;
}

export interface EstablishedInfo {
  safetyCode: string;
  hostFingerprint: string;
  guestFingerprint: string;
}

export type ReceiveResult =
  | { kind: 'handshake-done'; info: EstablishedInfo }
  | { kind: 'data'; plaintext: Uint8Array }
  | { kind: 'dropped'; reason: string };

/**
 * Zustandsmaschine der Verschlüsselungsschicht. Frames müssen in Empfangsreihenfolge und
 * nacheinander (awaited) an {@link receive} übergeben werden.
 */
export class SecureChannel {
  private keyPair: KeyPair | null = null;
  private keys: SessionKeys | null = null;
  private peerHandshakeSeen = false;
  private sendQueue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: SecureChannelOptions) {}

  get established(): boolean {
    return this.keys !== null;
  }

  /** Erzeugt das Schlüsselpaar und sendet den eigenen Handshake. */
  async start(): Promise<void> {
    this.keyPair = await generateKeyPair();
    this.opts.transmit(encodeHandshake(this.opts.role, this.keyPair.publicKey));
  }

  /** Verarbeitet einen eingehenden Frame. Wirft {@link HandshakeError} bei Protokollverletzungen. */
  async receive(frame: Uint8Array): Promise<ReceiveResult> {
    if (frame.length === 0) return { kind: 'dropped', reason: 'leer' };
    if (frame[0] === FRAME_KIND_HANDSHAKE) {
      if (this.peerHandshakeSeen) throw new HandshakeError('Doppelter Handshake');
      if (!this.keyPair) throw new HandshakeError('Handshake vor Start');
      this.peerHandshakeSeen = true;
      const peerRole: Role = this.opts.role === 'host' ? 'guest' : 'host';
      const peerPublic = decodeHandshake(frame, peerRole);
      if (bytesEqual(peerPublic, this.keyPair.publicKey)) throw new HandshakeError('Reflektierter Schlüssel');
      const isHost = this.opts.role === 'host';
      const hostPublicKey = isHost ? this.keyPair.publicKey : peerPublic;
      const guestPublicKey = isHost ? peerPublic : this.keyPair.publicKey;
      const hostFingerprint = isHost ? this.opts.localFingerprint : this.opts.remoteFingerprint;
      const guestFingerprint = isHost ? this.opts.remoteFingerprint : this.opts.localFingerprint;
      let keys: SessionKeys;
      try {
        keys = await deriveSessionKeys({
          role: this.opts.role,
          privateKey: this.keyPair.privateKey,
          hostPublicKey,
          guestPublicKey,
          hostFingerprint,
          guestFingerprint,
        });
      } catch {
        throw new HandshakeError('Schlüsselableitung fehlgeschlagen');
      }
      const safetyCode = await computeSafetyCode({ hostFingerprint, guestFingerprint, hostPublicKey, guestPublicKey });
      this.keys = keys;
      return { kind: 'handshake-done', info: { safetyCode, hostFingerprint, guestFingerprint } };
    }
    if (frame[0] === FRAME_KIND_ENCRYPTED) {
      // Vor Abschluss des Handshakes keine Anwendungsdaten.
      if (!this.keys) throw new HandshakeError('Daten vor Handshake');
      const result = await this.keys.receive.open(frame);
      if (!result.ok) return { kind: 'dropped', reason: result.reason };
      return { kind: 'data', plaintext: result.plaintext };
    }
    return { kind: 'dropped', reason: 'unbekannter Frame' };
  }

  /** Verschlüsselt und sendet in Aufrufreihenfolge. */
  send(plaintext: Uint8Array): Promise<void> {
    const keys = this.keys;
    if (!keys) return Promise.reject(new HandshakeError('Handshake nicht abgeschlossen'));
    const next = this.sendQueue.then(async () => {
      const frame = await keys.send.seal(plaintext);
      this.opts.transmit(frame);
    });
    this.sendQueue = next.catch(() => undefined);
    return next;
  }

  /** Verschlüsselt eine abschließende Nachricht mit reserviertem Zähler (synchron sendbar, z. B. bei pagehide). */
  async prepareFinal(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.keys) throw new HandshakeError('Handshake nicht abgeschlossen');
    return this.keys.send.sealFinal(plaintext);
  }
}
