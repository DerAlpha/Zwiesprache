import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  chunkCount,
  decodeChunk,
  encodeChunk,
  expectedChunkLength,
  splitIntoChunks,
} from '../src/files/chunking';
import { detectPreviewImage } from '../src/files/magic';
import { assembleFile, IncomingTransfer, OutgoingTransfer, sha256Hex, type ChunkSink } from '../src/files/transfer';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let off = 0; off < n; off += 65536) crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, n)));
  return out;
}

async function hashOf(bytes: Uint8Array) {
  return sha256Hex(bytes.slice().buffer as ArrayBuffer);
}

describe('Chunking', () => {
  it('berechnet Anzahl und Längen', () => {
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(1)).toBe(1);
    expect(chunkCount(CHUNK_SIZE)).toBe(1);
    expect(chunkCount(CHUNK_SIZE + 1)).toBe(2);
    expect(expectedChunkLength(CHUNK_SIZE + 5, 0)).toBe(CHUNK_SIZE);
    expect(expectedChunkLength(CHUNK_SIZE + 5, 1)).toBe(5);
    expect(expectedChunkLength(CHUNK_SIZE + 5, 2)).toBe(-1);
  });

  it('kodiert und dekodiert Chunk-Frames', () => {
    const data = randomBytes(CHUNK_SIZE);
    const frame = encodeChunk('fileid123456', 7, data);
    const decoded = decodeChunk(frame)!;
    expect(decoded.fileId).toBe('fileid123456');
    expect(decoded.index).toBe(7);
    expect(decoded.data).toEqual(data);
  });

  it('lehnt fehlerhafte Chunks ab', () => {
    expect(() => encodeChunk('bad id!', 0, new Uint8Array(1))).toThrow();
    expect(() => encodeChunk('ok', 0, new Uint8Array(CHUNK_SIZE + 1))).toThrow();
    expect(decodeChunk(new Uint8Array([0x02]))).toBeNull();
    expect(decodeChunk(new Uint8Array([0x02, 40, 1, 2]))).toBeNull();
    const frame = encodeChunk('abc', 0, new Uint8Array(4));
    frame[2] = 0x3c; // "<" in der ID
    expect(decodeChunk(frame)).toBeNull();
    const tooBig = new Uint8Array(2 + 3 + 4 + CHUNK_SIZE + 1);
    tooBig.set([0x02, 3, 97, 98, 99]);
    expect(decodeChunk(tooBig)).toBeNull();
  });

  it('zerlegt und setzt zusammen (Roundtrip mit SHA-256)', async () => {
    const data = randomBytes(CHUNK_SIZE * 3 + 123);
    const sha = await hashOf(data);
    const incoming = new IncomingTransfer('fileid123456', data.length, sha);
    let index = 0;
    for (const part of splitIntoChunks(data)) {
      expect(incoming.add(decodeChunk(encodeChunk('fileid123456', index++, part))!)).toBe(true);
    }
    expect(incoming.isComplete).toBe(true);
    const result = await incoming.finish();
    expect(result).not.toBeNull();
    expect(new Uint8Array(await result!.blob.arrayBuffer())).toEqual(data);
    expect(result!.blob.type).toBe('application/octet-stream');
  });

  it('erzwingt Reihenfolge und exakte Chunk-Längen', () => {
    const incoming = new IncomingTransfer('f1234567', CHUNK_SIZE * 2, 'a'.repeat(64));
    expect(incoming.add({ fileId: 'f1234567', index: 1, data: new Uint8Array(CHUNK_SIZE) })).toBe(false);
    expect(incoming.add({ fileId: 'f1234567', index: 0, data: new Uint8Array(10) })).toBe(false);
    expect(incoming.add({ fileId: 'f1234567', index: 0, data: new Uint8Array(CHUNK_SIZE) })).toBe(true);
    expect(incoming.add({ fileId: 'f1234567', index: 0, data: new Uint8Array(CHUNK_SIZE) })).toBe(false);
  });

  it('verwirft Dateien mit falschem Hash', async () => {
    const data = randomBytes(1000);
    expect(await assembleFile([data], 'b'.repeat(64))).toBeNull();
  });
});

describe('Magic Bytes', () => {
  it('erkennt nur PNG/JPEG/GIF/WebP', () => {
    expect(detectPreviewImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(detectPreviewImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectPreviewImage(new TextEncoder().encode('GIF89a...'))).toBe('image/gif');
    expect(detectPreviewImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectPreviewImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectPreviewImage(new TextEncoder().encode('<!doctype html><script>'))).toBeNull();
    expect(detectPreviewImage(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
  });

  it('typisiert empfangene Bilder anhand der Bytes, nicht des Namens', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const result = await assembleFile([png], await hashOf(png));
    expect(result?.previewType).toBe('image/png');
    expect(result?.blob.type).toBe('image/png');
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    const r2 = await assembleFile([svg], await hashOf(svg));
    expect(r2?.previewType).toBeNull();
    expect(r2?.blob.type).toBe('application/octet-stream');
  });
});

describe('OutgoingTransfer', () => {
  it('sendet alle Chunks in Reihenfolge und wartet auf Backpressure', async () => {
    const data = randomBytes(CHUNK_SIZE * 70 + 7); // > 1 Lese-Block
    const sent: { index: number; data: Uint8Array }[] = [];
    let drains = 0;
    const sink: ChunkSink = {
      async sendChunk(_id, index, chunk) {
        sent.push({ index, data: chunk.slice() });
      },
      async waitForDrain() {
        drains++;
      },
    };
    const progress: number[] = [];
    const tr = new OutgoingTransfer('file12345678', new Blob([data as Uint8Array<ArrayBuffer>]));
    expect(await tr.send(sink, (n) => progress.push(n))).toBe('done');
    expect(sent.map((s) => s.index)).toEqual([...Array(71).keys()]);
    expect(drains).toBe(71);
    expect(progress.at(-1)).toBe(data.length);
    const joined = new Uint8Array(await new Blob(sent.map((s) => s.data as Uint8Array<ArrayBuffer>)).arrayBuffer());
    expect(joined).toEqual(data);
  });

  it('lässt sich abbrechen', async () => {
    const tr = new OutgoingTransfer('file12345678', new Blob([randomBytes(CHUNK_SIZE * 10) as Uint8Array<ArrayBuffer>]));
    let count = 0;
    const sink: ChunkSink = {
      async sendChunk() {
        if (++count === 3) tr.cancel();
      },
      async waitForDrain() {},
    };
    expect(await tr.send(sink, () => undefined)).toBe('cancelled');
    expect(count).toBe(3);
  });
});
