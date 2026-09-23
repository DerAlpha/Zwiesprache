// Einladungs-/Antwortcodes: Versionspräfix + base64url(deflate-raw(JSON-Payload)).
//
// Payload (kompakt): { v: 1, t: "o" | "a", s: <Session-ID>, d: <minimierte SDP> }
// Alle eingehenden Codes sind untrusted und werden vor und nach der Dekompression begrenzt.

import { fromBase64Url, randomId, toBase64Url, utf8Decode, utf8Encode } from '../util/bytes';
import { MAX_SDP_LENGTH, minimizeSdp, restoreSdp, validateRemoteSdp } from './sdp';

export const CODE_VERSION = 1;
/** Ein Zeichen Versionspräfix vor dem base64url-Teil. */
export const CODE_PREFIX = '1';
/** Maximale Codelänge in Zeichen (vor der Dekompression). */
export const MAX_CODE_LENGTH = 4096;
/** Maximale Größe des dekomprimierten Payloads in Bytes (Schutz vor Decompression-Bombs). */
export const MAX_PAYLOAD_BYTES = 12 * 1024;

export type SignalType = 'offer' | 'answer';

export interface SignalPayload {
  version: typeof CODE_VERSION;
  type: SignalType;
  /** Session-ID der Einladung (bei Antworten: die der beantworteten Einladung). */
  sessionId: string;
  /** Vollständige SDP (CRLF) – beim Kodieren wird sie minimiert. */
  sdp: string;
}

export type CodecErrorReason = 'empty' | 'too-long' | 'format' | 'version' | 'too-large' | 'decompress' | 'structure';

export class CodecError extends Error {
  constructor(readonly reason: CodecErrorReason) {
    super(`Ungültiger Code (${reason})`);
    this.name = 'CodecError';
  }
}

const SESSION_ID_RE = /^[A-Za-z0-9_-]{12}$/;

export function newSessionId(): string {
  return randomId(9); // 72 Bit, 12 Zeichen base64url
}

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

async function readAllLimited(readable: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new CodecError('too-large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number) {
  const writer = stream.writable.getWriter();
  // Fehler landen auch auf der lesenden Seite; hier nur "unhandled rejection" vermeiden.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
  writer.close().catch(() => undefined);
  return readAllLimited(stream.readable as ReadableStream<Uint8Array>, limit);
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return transform(data, new CompressionStream('deflate-raw'), Number.MAX_SAFE_INTEGER);
}

export async function inflateRawLimited(data: Uint8Array, limit: number): Promise<Uint8Array> {
  try {
    return await transform(data, new DecompressionStream('deflate-raw'), limit);
  } catch (e) {
    if (e instanceof CodecError) throw e;
    throw new CodecError('decompress');
  }
}

/** Kodiert eine Einladung/Antwort. Die SDP wird dabei verlustfrei minimiert. */
export async function encodeSignal(payload: SignalPayload): Promise<string> {
  const wire = {
    v: payload.version,
    t: payload.type === 'offer' ? 'o' : 'a',
    s: payload.sessionId,
    d: minimizeSdp(payload.sdp),
  };
  const compressed = await deflateRaw(utf8Encode(JSON.stringify(wire)));
  return CODE_PREFIX + toBase64Url(compressed);
}

/** Entfernt Leerraum (z. B. Zeilenumbrüche aus Messengern). */
export function normalizeCode(code: string): string {
  return code.replace(/\s+/g, '');
}

/** Dekodiert und validiert einen Code streng. Wirft {@link CodecError}. */
export async function decodeSignal(rawCode: string): Promise<SignalPayload> {
  const code = normalizeCode(rawCode);
  if (code.length === 0) throw new CodecError('empty');
  if (code.length > MAX_CODE_LENGTH) throw new CodecError('too-long');
  if (!/^[0-9A-Za-z][A-Za-z0-9_-]+$/.test(code)) throw new CodecError('format');
  if (code[0] !== CODE_PREFIX) throw new CodecError('version');

  let compressed: Uint8Array;
  try {
    compressed = fromBase64Url(code.slice(1));
  } catch {
    throw new CodecError('format');
  }
  const bytes = await inflateRawLimited(compressed, MAX_PAYLOAD_BYTES);

  let wire: unknown;
  try {
    wire = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new CodecError('structure');
  }
  if (typeof wire !== 'object' || wire === null || Array.isArray(wire)) throw new CodecError('structure');
  const w = wire as Record<string, unknown>;
  const keys = Object.keys(w).sort().join(',');
  if (keys !== 'd,s,t,v') throw new CodecError('structure');
  if (w.v !== CODE_VERSION) throw new CodecError('version');
  if (w.t !== 'o' && w.t !== 'a') throw new CodecError('structure');
  if (!isValidSessionId(w.s)) throw new CodecError('structure');
  if (typeof w.d !== 'string' || w.d.length === 0 || w.d.length > MAX_SDP_LENGTH) throw new CodecError('structure');

  const type: SignalType = w.t === 'o' ? 'offer' : 'answer';
  const sdp = restoreSdp(w.d);
  if (validateRemoteSdp(sdp, type) !== null) throw new CodecError('structure');
  return { version: CODE_VERSION, type, sessionId: w.s, sdp };
}
