// AES-256-GCM mit 96-Bit-Zähler als IV, ein Schlüssel und ein Zähler pro Richtung.
//
// Frame: [0x01][Zähler: uint64 BE][Ciphertext || Tag]
// IV   = 0x00000000 || Zähler (uint64 BE)  → 96 Bit, nie wiederverwendet
// AAD  = die ersten 9 Bytes des Frames (Typ + Zähler)
//
// Der Empfänger akzeptiert nur strikt steigende Zähler und verwirft Frames mit ungültigem Tag,
// ohne den Zählerstand zu verändern.

import { toArrayBuffer } from '../util/bytes';

export const FRAME_KIND_ENCRYPTED = 0x01;
export const HEADER_LENGTH = 9;
export const TAG_LENGTH = 16;
/** Reservierter Zählerwert für die vorab verschlüsselte "bye"-Nachricht (siehe SecureChannel). */
export const FINAL_COUNTER = Number.MAX_SAFE_INTEGER;
const TWO_POW_32 = 0x1_0000_0000;

function writeHeader(counter: number): Uint8Array {
  const header = new Uint8Array(HEADER_LENGTH);
  header[0] = FRAME_KIND_ENCRYPTED;
  const view = new DataView(header.buffer);
  view.setUint32(1, Math.floor(counter / TWO_POW_32));
  view.setUint32(5, counter >>> 0);
  return header;
}

function ivFromCounter(counter: number): Uint8Array {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setUint32(4, Math.floor(counter / TWO_POW_32));
  view.setUint32(8, counter >>> 0);
  return iv;
}

export function readCounter(frame: Uint8Array): number | null {
  if (frame.length < HEADER_LENGTH + TAG_LENGTH || frame[0] !== FRAME_KIND_ENCRYPTED) return null;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const hi = view.getUint32(1);
  const lo = view.getUint32(5);
  const counter = hi * TWO_POW_32 + lo;
  return Number.isSafeInteger(counter) ? counter : null;
}

async function seal(key: CryptoKey, counter: number, plaintext: Uint8Array): Promise<Uint8Array> {
  const header = writeHeader(counter);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(ivFromCounter(counter)), additionalData: toArrayBuffer(header), tagLength: 128 },
    key,
    toArrayBuffer(plaintext),
  );
  const frame = new Uint8Array(HEADER_LENGTH + ct.byteLength);
  frame.set(header, 0);
  frame.set(new Uint8Array(ct), HEADER_LENGTH);
  return frame;
}

export class SendCipher {
  private counter = 0;

  constructor(private readonly key: CryptoKey) {}

  /**
   * Verschlüsselt mit dem nächsten Zählerwert. Der Zähler wird synchron vergeben;
   * Aufrufer müssen Frames in Aufrufreihenfolge senden.
   */
  seal(plaintext: Uint8Array): Promise<Uint8Array> {
    if (this.counter + 1 >= FINAL_COUNTER) throw new Error('Zähler erschöpft');
    this.counter += 1;
    return seal(this.key, this.counter, plaintext);
  }

  /** Verschlüsselt mit dem reservierten Endzähler (nur für die abschließende Nachricht). */
  sealFinal(plaintext: Uint8Array): Promise<Uint8Array> {
    return seal(this.key, FINAL_COUNTER, plaintext);
  }
}

export type OpenResult = { ok: true; plaintext: Uint8Array; counter: number } | { ok: false; reason: 'format' | 'replay' | 'auth' };

export class ReceiveCipher {
  private lastCounter = 0;

  constructor(private readonly key: CryptoKey) {}

  async open(frame: Uint8Array): Promise<OpenResult> {
    const counter = readCounter(frame);
    if (counter === null) return { ok: false, reason: 'format' };
    if (counter <= this.lastCounter) return { ok: false, reason: 'replay' };
    try {
      const pt = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(ivFromCounter(counter)),
          additionalData: toArrayBuffer(frame.subarray(0, HEADER_LENGTH)),
          tagLength: 128,
        },
        this.key,
        toArrayBuffer(frame.subarray(HEADER_LENGTH)),
      );
      // Erneut prüfen: parallele open()-Aufrufe dürfen den Zähler nicht zurücksetzen.
      if (counter <= this.lastCounter) return { ok: false, reason: 'replay' };
      this.lastCounter = counter;
      return { ok: true, plaintext: new Uint8Array(pt), counter };
    } catch {
      return { ok: false, reason: 'auth' };
    }
  }
}
