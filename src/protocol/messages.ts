// Versioniertes Anwendungsprotokoll. Jede Nachricht: { v, type, id, ts, … }.
// Alle eingehenden Nachrichten sind untrusted: strikte Schema-Prüfung, unbekannte Typen werden ignoriert.

import { randomId } from '../util/bytes';

export const PROTOCOL_VERSION = 1;
export const MAX_TEXT_LENGTH = 10_000;
export const MAX_FILE_NAME_LENGTH = 255;
export const MAX_FILE_SIZE = 200 * 1024 * 1024;
/** Obergrenze für eine serialisierte JSON-Nachricht in Bytes. */
export const MAX_JSON_BYTES = 64 * 1024;

const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const MIME_RE = /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/;

interface Base {
  v: typeof PROTOCOL_VERSION;
  id: string;
  ts: number;
}

/** Schlüsselbestätigung direkt nach dem Handshake. */
export interface ReadyMessage extends Base {
  type: 'ready';
}
export interface TextMessage extends Base {
  type: 'text';
  body: string;
}
/** Zustellbestätigung für eine Text- oder Dateinachricht. */
export interface AckMessage extends Base {
  type: 'ack';
  ref: string;
}
export interface TypingMessage extends Base {
  type: 'typing';
  active: boolean;
}
export interface FileOfferMessage extends Base {
  type: 'file-offer';
  name: string;
  size: number;
  mime: string;
  sha256: string;
}
export interface FileCancelMessage extends Base {
  type: 'file-cancel';
  ref: string;
}
export interface ByeMessage extends Base {
  type: 'bye';
}

export type Message =
  | ReadyMessage
  | TextMessage
  | AckMessage
  | TypingMessage
  | FileOfferMessage
  | FileCancelMessage
  | ByeMessage;

export type MessageType = Message['type'];

type Without<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type MessageInit = Without<Message, 'v' | 'id' | 'ts'> & { id?: string };

export function newMessageId(): string {
  return randomId(12);
}

export function createMessage(init: MessageInit): Message {
  return { ...init, v: PROTOCOL_VERSION, id: init.id ?? newMessageId(), ts: Date.now() } as Message;
}

function isId(x: unknown): x is string {
  return typeof x === 'string' && ID_RE.test(x);
}

function isTimestamp(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 8.64e15;
}

/** Entfernt Steuerzeichen (außer Zeilenumbruch/Tab) und Bidi-Overrides aus Dateinamen. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned : 'datei';
}

export type ParseResult = { ok: true; message: Message } | { ok: false; reason: 'invalid' | 'unknown-type' };

/**
 * Prüft eine dekodierte (untrusted) Nachricht gegen das Schema.
 * Unbekannte Typen liefern `unknown-type` und werden vom Aufrufer ignoriert.
 * Es werden nur bekannte Felder übernommen.
 */
export function parseMessage(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'invalid' };
  const r = raw as Record<string, unknown>;
  if (r.v !== PROTOCOL_VERSION) return { ok: false, reason: 'invalid' };
  if (typeof r.type !== 'string' || r.type.length > 32) return { ok: false, reason: 'invalid' };
  if (!isId(r.id) || !isTimestamp(r.ts)) return { ok: false, reason: 'invalid' };
  const base = { v: PROTOCOL_VERSION, id: r.id, ts: r.ts } as const;

  switch (r.type) {
    case 'ready':
      return { ok: true, message: { ...base, type: 'ready' } };
    case 'bye':
      return { ok: true, message: { ...base, type: 'bye' } };
    case 'text':
      if (typeof r.body !== 'string' || r.body.length === 0 || r.body.length > MAX_TEXT_LENGTH) {
        return { ok: false, reason: 'invalid' };
      }
      return { ok: true, message: { ...base, type: 'text', body: r.body } };
    case 'ack':
      if (!isId(r.ref)) return { ok: false, reason: 'invalid' };
      return { ok: true, message: { ...base, type: 'ack', ref: r.ref } };
    case 'typing':
      if (typeof r.active !== 'boolean') return { ok: false, reason: 'invalid' };
      return { ok: true, message: { ...base, type: 'typing', active: r.active } };
    case 'file-offer':
      if (
        typeof r.name !== 'string' ||
        r.name.length === 0 ||
        r.name.length > MAX_FILE_NAME_LENGTH ||
        typeof r.size !== 'number' ||
        !Number.isSafeInteger(r.size) ||
        r.size < 0 ||
        r.size > MAX_FILE_SIZE ||
        typeof r.mime !== 'string' ||
        !MIME_RE.test(r.mime) ||
        typeof r.sha256 !== 'string' ||
        !HASH_RE.test(r.sha256)
      ) {
        return { ok: false, reason: 'invalid' };
      }
      return {
        ok: true,
        message: { ...base, type: 'file-offer', name: sanitizeFileName(r.name), size: r.size, mime: r.mime, sha256: r.sha256 },
      };
    case 'file-cancel':
      if (!isId(r.ref)) return { ok: false, reason: 'invalid' };
      return { ok: true, message: { ...base, type: 'file-cancel', ref: r.ref } };
    default:
      return { ok: false, reason: 'unknown-type' };
  }
}
