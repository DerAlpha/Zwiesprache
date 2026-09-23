// Einladungs-/Antwortlinks. Codes stehen ausschließlich im URL-Fragment (#), das nie an den
// Webserver übertragen wird – niemals im Query-String.

import { CodecError, MAX_CODE_LENGTH, decodeSignal, normalizeCode, type SignalPayload, type SignalType } from './codec';

export const INVITE_KEY = 'i';
export const ANSWER_KEY = 'a';
const MAX_INPUT_LENGTH = MAX_CODE_LENGTH + 2048;

/** Basis-URL der App ohne Query und Fragment. */
export function appBaseUrl(loc: Pick<Location, 'href'> = location): string {
  const url = new URL(loc.href);
  url.hash = '';
  url.search = '';
  return url.href;
}

/** Ob Links auf andere Geräte übertragbar sind (nicht bei lokal geöffneter Datei). */
export function linksAreShareable(loc: Pick<Location, 'protocol'> = location): boolean {
  return loc.protocol === 'https:' || loc.protocol === 'http:';
}

export function buildLink(type: SignalType, code: string, base = appBaseUrl()): string {
  return `${base}#${type === 'offer' ? INVITE_KEY : ANSWER_KEY}=${code}`;
}

export interface ParsedInput {
  /** Typ laut Link-Fragment; null bei reinem Code. */
  hint: SignalType | null;
  code: string;
}

/** Erkennt Link, Fragment ("#i=…", "a=…") oder reinen Code. Wirft {@link CodecError}. */
export function parseInput(text: string): ParsedInput {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new CodecError('empty');
  if (trimmed.length > MAX_INPUT_LENGTH) throw new CodecError('too-long');

  const hashIdx = trimmed.indexOf('#');
  const candidate = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : trimmed;
  const m = /^([ia])=(\S*)/.exec(candidate);
  if (m) {
    return { hint: m[1] === INVITE_KEY ? 'offer' : 'answer', code: m[2]! };
  }
  if (hashIdx >= 0) throw new CodecError('format');
  return { hint: null, code: normalizeCode(trimmed) };
}

/** Parst und dekodiert eine Eingabe; prüft, dass Link-Typ und Payload-Typ übereinstimmen. */
export async function decodeInput(text: string): Promise<SignalPayload> {
  const parsed = parseInput(text);
  const payload = await decodeSignal(parsed.code);
  if (parsed.hint !== null && parsed.hint !== payload.type) throw new CodecError('structure');
  return payload;
}

/**
 * Liest einen Code aus dem aktuellen URL-Fragment und entfernt ihn sofort aus URL und Verlauf.
 * Gibt den rohen Fragmentinhalt ("i=…"/"a=…") zurück oder null.
 */
export function consumeFragment(): string | null {
  const hash = location.hash;
  if (hash.length <= 1) return null;
  const fragment = hash.slice(1);
  try {
    history.replaceState(null, '', appBaseUrl());
  } catch {
    // z. B. in Sandbox-Umgebungen – dann wenigstens das Fragment leeren
    location.hash = '';
  }
  return /^[ia]=/.test(fragment) ? fragment : null;
}
