import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeMessageFrame, FRAME_KIND_JSON } from '../src/protocol/frames';
import { createMessage, MAX_FILE_SIZE, MAX_TEXT_LENGTH, parseMessage, sanitizeFileName } from '../src/protocol/messages';
import { TokenBucket } from '../src/protocol/rate-limit';
import { utf8Encode } from '../src/util/bytes';

const base = { v: 1, id: 'abcdefgh1234', ts: 1_700_000_000_000 };
const sha = 'a'.repeat(64);

describe('Protokoll-Validierung', () => {
  it('akzeptiert gültige Nachrichten aller Typen', () => {
    for (const msg of [
      { ...base, type: 'ready' },
      { ...base, type: 'bye' },
      { ...base, type: 'text', body: 'Hallo 👋\nZeile 2' },
      { ...base, type: 'ack', ref: 'zzzzzzzz' },
      { ...base, type: 'typing', active: true },
      { ...base, type: 'file-offer', name: 'bild.png', size: 1234, mime: 'image/png', sha256: sha },
      { ...base, type: 'file-cancel', ref: 'zzzzzzzz' },
    ]) {
      expect(parseMessage(msg)).toMatchObject({ ok: true, message: msg });
    }
  });

  it('ignoriert unbekannte Typen', () => {
    expect(parseMessage({ ...base, type: 'call-offer' })).toEqual({ ok: false, reason: 'unknown-type' });
  });

  it('prüft Version, ID, Zeitstempel', () => {
    expect(parseMessage({ ...base, v: 2, type: 'bye' }).ok).toBe(false);
    expect(parseMessage({ ...base, id: 'x', type: 'bye' }).ok).toBe(false);
    expect(parseMessage({ ...base, id: '<script>alert(1)</script>', type: 'bye' }).ok).toBe(false);
    expect(parseMessage({ ...base, ts: -1, type: 'bye' }).ok).toBe(false);
    expect(parseMessage({ ...base, ts: Number.NaN, type: 'bye' }).ok).toBe(false);
    expect(parseMessage({ ...base, ts: '1', type: 'bye' }).ok).toBe(false);
    expect(parseMessage(null).ok).toBe(false);
    expect(parseMessage([base]).ok).toBe(false);
    expect(parseMessage('text').ok).toBe(false);
  });

  it('begrenzt Textlänge auf 10.000 Zeichen', () => {
    expect(parseMessage({ ...base, type: 'text', body: 'x'.repeat(MAX_TEXT_LENGTH) }).ok).toBe(true);
    expect(parseMessage({ ...base, type: 'text', body: 'x'.repeat(MAX_TEXT_LENGTH + 1) }).ok).toBe(false);
    expect(parseMessage({ ...base, type: 'text', body: '' }).ok).toBe(false);
    expect(parseMessage({ ...base, type: 'text', body: 42 }).ok).toBe(false);
  });

  it('prüft Dateiangebote streng', () => {
    const offer = { ...base, type: 'file-offer', name: 'a.txt', size: 10, mime: 'text/plain', sha256: sha };
    expect(parseMessage(offer).ok).toBe(true);
    expect(parseMessage({ ...offer, size: MAX_FILE_SIZE + 1 }).ok).toBe(false);
    expect(parseMessage({ ...offer, size: 1.5 }).ok).toBe(false);
    expect(parseMessage({ ...offer, size: -1 }).ok).toBe(false);
    expect(parseMessage({ ...offer, sha256: 'xyz' }).ok).toBe(false);
    expect(parseMessage({ ...offer, mime: 'text/html; charset=utf-8' }).ok).toBe(false);
    expect(parseMessage({ ...offer, name: '' }).ok).toBe(false);
  });

  it('übernimmt nur bekannte Felder', () => {
    const r = parseMessage({ ...base, type: 'text', body: 'hi', __proto__x: 1, html: '<b>' });
    expect(r.ok && Object.keys(r.message).sort()).toEqual(['body', 'id', 'ts', 'type', 'v']);
  });

  it('bereinigt Dateinamen', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFileName('rechnung‮gpj.exe')).toBe('rechnunggpj.exe');
    expect(sanitizeFileName('a\u0000b\nc.txt')).toBe('abc.txt');
    expect(sanitizeFileName('..')).toBe('datei');
    expect(sanitizeFileName('x'.repeat(400)).length).toBe(255);
  });

  it('Frames: JSON-Roundtrip und kaputte Frames', () => {
    const msg = createMessage({ type: 'text', body: 'Grüße' });
    const frame = encodeMessageFrame(msg);
    expect(frame[0]).toBe(FRAME_KIND_JSON);
    const decoded = decodeFrame(frame);
    expect(decoded?.kind === 'json' && parseMessage(decoded.value)).toMatchObject({ ok: true, message: msg });
    expect(decodeFrame(new Uint8Array([]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0x09, 1, 2]))).toBeNull();
    expect(decodeFrame(new Uint8Array([FRAME_KIND_JSON, ...utf8Encode('{nope')]))).toBeNull();
    expect(decodeFrame(new Uint8Array([FRAME_KIND_JSON, 0xff, 0xfe]))).toBeNull(); // ungültiges UTF-8
  });
});

describe('Rate-Limit', () => {
  it('Token-Bucket begrenzt und füllt nach', () => {
    let now = 0;
    const bucket = new TokenBucket(3, 1, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    now += 1000;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now += 60_000;
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
  });
});
