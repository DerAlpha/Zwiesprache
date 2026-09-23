// Datei-Chunks im Klartext-Frame (innerhalb der Verschlüsselungsschicht):
// [0x02][ID-Länge: 1 Byte][ID (ASCII)][Index: uint32 BE][Daten]

export const CHUNK_SIZE = 16 * 1024;
export const FRAME_KIND_CHUNK = 0x02;
const MAX_ID_LENGTH = 32;

export function chunkCount(size: number): number {
  return size === 0 ? 0 : Math.ceil(size / CHUNK_SIZE);
}

/** Erwartete Länge von Chunk `index` einer Datei der Größe `size`. */
export function expectedChunkLength(size: number, index: number): number {
  const count = chunkCount(size);
  if (index < 0 || index >= count) return -1;
  return index === count - 1 ? size - index * CHUNK_SIZE : CHUNK_SIZE;
}

export function encodeChunk(fileId: string, index: number, data: Uint8Array): Uint8Array {
  if (fileId.length === 0 || fileId.length > MAX_ID_LENGTH || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    throw new Error('Ungültige Datei-ID');
  }
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error('Ungültiger Index');
  if (data.length > CHUNK_SIZE) throw new Error('Chunk zu groß');
  const out = new Uint8Array(2 + fileId.length + 4 + data.length);
  out[0] = FRAME_KIND_CHUNK;
  out[1] = fileId.length;
  for (let i = 0; i < fileId.length; i++) out[2 + i] = fileId.charCodeAt(i);
  const view = new DataView(out.buffer);
  view.setUint32(2 + fileId.length, index);
  out.set(data, 2 + fileId.length + 4);
  return out;
}

export interface DecodedChunk {
  fileId: string;
  index: number;
  data: Uint8Array;
}

/** Dekodiert einen Chunk-Frame streng; null bei Formfehlern. */
export function decodeChunk(frame: Uint8Array): DecodedChunk | null {
  if (frame.length < 2 || frame[0] !== FRAME_KIND_CHUNK) return null;
  const idLen = frame[1]!;
  if (idLen === 0 || idLen > MAX_ID_LENGTH || frame.length < 2 + idLen + 4) return null;
  let fileId = '';
  for (let i = 0; i < idLen; i++) {
    const c = frame[2 + i]!;
    const ch = String.fromCharCode(c);
    if (!/[A-Za-z0-9_-]/.test(ch)) return null;
    fileId += ch;
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const index = view.getUint32(2 + idLen);
  const data = frame.subarray(2 + idLen + 4);
  if (data.length > CHUNK_SIZE) return null;
  return { fileId, index, data };
}

/** Zerlegt Bytes in Chunks (für Tests und kleine Puffer). */
export function* splitIntoChunks(bytes: Uint8Array): Generator<Uint8Array> {
  for (let off = 0; off < bytes.length; off += CHUNK_SIZE) {
    yield bytes.subarray(off, Math.min(off + CHUNK_SIZE, bytes.length));
  }
}
