// Klartext-Frames innerhalb der Verschlüsselungsschicht.
// 0x01 = JSON-Nachricht (UTF-8), 0x02 = Datei-Chunk (siehe files/chunking.ts)

import { decodeChunk, FRAME_KIND_CHUNK, type DecodedChunk } from '../files/chunking';
import { utf8Decode, utf8Encode } from '../util/bytes';
import { MAX_JSON_BYTES, type Message } from './messages';

export const FRAME_KIND_JSON = 0x01;

export function encodeMessageFrame(message: Message): Uint8Array {
  const json = utf8Encode(JSON.stringify(message));
  if (json.length > MAX_JSON_BYTES) throw new Error('Nachricht zu groß');
  const out = new Uint8Array(json.length + 1);
  out[0] = FRAME_KIND_JSON;
  out.set(json, 1);
  return out;
}

export type DecodedFrame = { kind: 'json'; value: unknown } | { kind: 'chunk'; chunk: DecodedChunk };

/** Dekodiert einen Klartext-Frame; null bei Formfehlern (Frame wird verworfen). */
export function decodeFrame(frame: Uint8Array): DecodedFrame | null {
  if (frame.length === 0) return null;
  if (frame[0] === FRAME_KIND_JSON) {
    if (frame.length - 1 > MAX_JSON_BYTES) return null;
    try {
      return { kind: 'json', value: JSON.parse(utf8Decode(frame.subarray(1))) };
    } catch {
      return null;
    }
  }
  if (frame[0] === FRAME_KIND_CHUNK) {
    const chunk = decodeChunk(frame);
    return chunk ? { kind: 'chunk', chunk } : null;
  }
  return null;
}
