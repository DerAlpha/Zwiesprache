// Dateiübertragung über die Verschlüsselungsschicht: 16-KiB-Chunks, Backpressure,
// Fortschritt, Abbrechen und SHA-256-Integritätsprüfung.

import { toHex } from '../util/bytes';
import { CHUNK_SIZE, chunkCount, expectedChunkLength, type DecodedChunk } from './chunking';
import { detectPreviewImage, type PreviewImageType } from './magic';

/** Anzahl Bytes, die pro Lesezugriff aus der Datei gelesen werden (mehrere Chunks). */
const READ_SIZE = 64 * CHUNK_SIZE;

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export interface ChunkSink {
  sendChunk(fileId: string, index: number, data: Uint8Array): Promise<void>;
  waitForDrain(): Promise<void>;
}

export class OutgoingTransfer {
  sent = 0;
  private cancelled = false;

  constructor(
    readonly id: string,
    readonly file: Blob,
  ) {}

  get size(): number {
    return this.file.size;
  }

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** Sendet alle Chunks; beachtet Backpressure und Abbruch. */
  async send(sink: ChunkSink, onProgress: (sent: number) => void): Promise<'done' | 'cancelled'> {
    let index = 0;
    for (let offset = 0; offset < this.size; ) {
      if (this.cancelled) return 'cancelled';
      const block = new Uint8Array(await this.file.slice(offset, offset + READ_SIZE).arrayBuffer());
      if (block.length === 0) throw new Error('Datei konnte nicht gelesen werden');
      for (let o = 0; o < block.length; o += CHUNK_SIZE) {
        await sink.waitForDrain();
        if (this.cancelled) return 'cancelled';
        const part = block.subarray(o, Math.min(o + CHUNK_SIZE, block.length));
        await sink.sendChunk(this.id, index++, part);
        this.sent += part.length;
        onProgress(this.sent);
      }
      offset += block.length;
    }
    return 'done';
  }
}

export interface ReceivedFile {
  blob: Blob;
  previewType: PreviewImageType | null;
}

/**
 * Setzt empfangene Chunks zusammen, prüft den SHA-256 und typisiert das Ergebnis:
 * Bilder (per Magic Bytes erkannt) mit Bild-MIME-Typ, alles andere als application/octet-stream.
 */
export async function assembleFile(chunks: readonly Uint8Array[], expectedSha256: string): Promise<ReceivedFile | null> {
  const buffer = await new Blob(chunks as unknown as BlobPart[]).arrayBuffer();
  if ((await sha256Hex(buffer)) !== expectedSha256) return null;
  const previewType = detectPreviewImage(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
  return { blob: new Blob([buffer], { type: previewType ?? 'application/octet-stream' }), previewType };
}

export class IncomingTransfer {
  received = 0;
  private nextIndex = 0;
  private chunks: Uint8Array[] = [];

  constructor(
    readonly id: string,
    readonly size: number,
    readonly sha256: string,
  ) {}

  get isComplete(): boolean {
    return this.nextIndex === chunkCount(this.size);
  }

  /** Nimmt einen Chunk an. Reihenfolge und Länge müssen exakt passen. */
  add(chunk: DecodedChunk): boolean {
    if (chunk.index !== this.nextIndex || this.isComplete) return false;
    if (chunk.data.length !== expectedChunkLength(this.size, chunk.index)) return false;
    this.chunks.push(chunk.data.slice());
    this.received += chunk.data.length;
    this.nextIndex++;
    return true;
  }

  async finish(): Promise<ReceivedFile | null> {
    const chunks = this.chunks;
    this.chunks = [];
    return assembleFile(chunks, this.sha256);
  }

  discard(): void {
    this.chunks = [];
  }
}
