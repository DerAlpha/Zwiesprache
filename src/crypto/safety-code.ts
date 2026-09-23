// Sicherheitscode gegen Man-in-the-Middle:
// SHA-256 über Kontext-Label, beide DTLS-Fingerprints und beide ECDH-Public-Keys in fester
// Reihenfolge (Host, Gast) → 20 Ziffern in 5 Viererblöcken.

import { concatBytes, utf8Encode } from '../util/bytes';

export const SAFETY_CODE_LABEL = 'Zwiesprache Sicherheitscode v1';

export interface SafetyCodeInput {
  hostFingerprint: string;
  guestFingerprint: string;
  hostPublicKey: Uint8Array;
  guestPublicKey: Uint8Array;
}

/** Längenpräfix (uint32 BE) + Daten, damit Feldgrenzen eindeutig sind. */
export function lengthPrefixed(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(data, 4);
  return out;
}

export async function computeSafetyCode(input: SafetyCodeInput): Promise<string> {
  const material = concatBytes(
    lengthPrefixed(utf8Encode(SAFETY_CODE_LABEL)),
    lengthPrefixed(utf8Encode(input.hostFingerprint)),
    lengthPrefixed(utf8Encode(input.guestFingerprint)),
    lengthPrefixed(input.hostPublicKey),
    lengthPrefixed(input.guestPublicKey),
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material as Uint8Array<ArrayBuffer>));
  const view = new DataView(digest.buffer);
  const groups: string[] = [];
  for (let i = 0; i < 5; i++) {
    // 32 Bit → 4 Ziffern; der Modulo-Bias (2^32 mod 10^4) ist vernachlässigbar (< 10^-5).
    groups.push(String(view.getUint32(i * 4) % 10_000).padStart(4, '0'));
  }
  return groups.join(' ');
}
