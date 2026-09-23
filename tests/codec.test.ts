import { describe, expect, it } from 'vitest';
import {
  CODE_PREFIX,
  CodecError,
  decodeSignal,
  deflateRaw,
  encodeSignal,
  MAX_CODE_LENGTH,
  MAX_PAYLOAD_BYTES,
  newSessionId,
} from '../src/signaling/codec';
import { buildLink, decodeInput, parseInput } from '../src/signaling/links';
import { extractFingerprints, minimizeSdp, restoreSdp, sdpLines, validateRemoteSdp } from '../src/signaling/sdp';
import { toBase64Url, utf8Encode } from '../src/util/bytes';
import { chromeAnswer, chromeOffer, fingerprint, firefoxOffer, randomFingerprint } from './fixtures';

async function expectCodecError(p: Promise<unknown>, reason: CodecError['reason']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof CodecError && e.reason === reason);
}

async function rawCode(obj: unknown): Promise<string> {
  return CODE_PREFIX + toBase64Url(await deflateRaw(utf8Encode(JSON.stringify(obj))));
}

describe('SDP-Minimierung', () => {
  it('entfernt nur optionale Zeilen und filtert Kandidaten', () => {
    const min = minimizeSdp(chromeOffer());
    const lines = sdpLines(min);
    expect(lines).not.toContain('a=extmap-allow-mixed');
    expect(lines.some((l) => l.startsWith('a=msid-semantic'))).toBe(false);
    expect(lines).not.toContain('a=ice-options:trickle');
    // TCP raus, Duplikat raus, IPv4/IPv6-Host und srflx bleiben
    const candidates = lines.filter((l) => l.startsWith('a=candidate:'));
    expect(candidates).toHaveLength(3);
    expect(candidates.every((c) => / udp /i.test(c))).toBe(true);
    // optionale Erweiterungen entfernt, raddr maskiert
    expect(min).not.toMatch(/generation|network-id|network-cost/);
    expect(min).toContain('typ srflx raddr 0.0.0.0 rport 0');
    // Pflichtzeilen unverändert
    for (const keep of ['a=group:BUNDLE 0', 'a=ice-ufrag:Xk3d', 'a=ice-pwd:9f2Pq8LmZr4Tn6Vb1Wc3Yd5E', 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144']) {
      expect(lines).toContain(keep);
    }
    expect(extractFingerprints(min)).toBe(extractFingerprints(chromeOffer()));
  });

  it('verarbeitet Firefox-SDP (UDP groß geschrieben, a=sendrecv)', () => {
    const min = minimizeSdp(firefoxOffer());
    expect(min).not.toContain('a=sendrecv');
    expect(min).not.toContain(' TCP ');
    expect(min).toContain('a=end-of-candidates');
    expect(validateRemoteSdp(restoreSdp(min), 'offer')).toBeNull();
  });

  it('stellt CRLF-Zeilenenden wieder her', () => {
    const restored = restoreSdp(minimizeSdp(chromeOffer()));
    expect(restored.endsWith('\r\n')).toBe(true);
    expect(restored.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
  });

  it('validiert Struktur streng', () => {
    const ok = restoreSdp(minimizeSdp(chromeOffer()));
    expect(validateRemoteSdp(ok, 'offer')).toBeNull();
    expect(validateRemoteSdp(ok, 'answer')).toBe('Setup');
    expect(validateRemoteSdp(ok.replace(/a=fingerprint:.*\r\n/, ''), 'offer')).toBe('Fingerprint');
    expect(validateRemoteSdp(ok.replace('m=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'm=audio 9 UDP/TLS/RTP/SAVPF 111'), 'offer')).toBe(
      'Medienzeile',
    );
    expect(validateRemoteSdp(ok + 'a=x:\u0007\r\n', 'offer')).toBe('Zeichen');
    expect(validateRemoteSdp(ok.replace(/a=ice-pwd:.*\r\n/, ''), 'offer')).toBe('ICE');
  });
});

describe('Codec', () => {
  it('Roundtrip für Einladung und Antwort', async () => {
    const sessionId = newSessionId();
    const code = await encodeSignal({ version: 1, type: 'offer', sessionId, sdp: chromeOffer() });
    expect(code.startsWith(CODE_PREFIX)).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = await decodeSignal(code);
    expect(decoded.type).toBe('offer');
    expect(decoded.sessionId).toBe(sessionId);
    expect(decoded.sdp).toBe(restoreSdp(minimizeSdp(chromeOffer())));

    const answer = await encodeSignal({ version: 1, type: 'answer', sessionId, sdp: chromeAnswer() });
    const decodedAnswer = await decodeSignal(answer);
    expect(decodedAnswer.type).toBe('answer');
    expect(decodedAnswer.sessionId).toBe(sessionId);
  });

  it('Einladungslink bleibt unter ~1000 Zeichen', async () => {
    const code = await encodeSignal({ version: 1, type: 'offer', sessionId: newSessionId(), sdp: chromeOffer(randomFingerprint()) });
    const link = buildLink('offer', code, 'https://beispiel.de/chat/');
    expect(link.length).toBeLessThan(1000);
  });

  it('ignoriert Leerraum (umgebrochene Codes)', async () => {
    const code = await encodeSignal({ version: 1, type: 'offer', sessionId: newSessionId(), sdp: chromeOffer() });
    const wrapped = code.replace(/(.{40})/g, '$1\n  ');
    await expect(decodeSignal(wrapped)).resolves.toMatchObject({ type: 'offer' });
  });

  it('lehnt leere, zu lange und fehlerhafte Codes ab', async () => {
    await expectCodecError(decodeSignal(''), 'empty');
    await expectCodecError(decodeSignal('1' + 'A'.repeat(MAX_CODE_LENGTH)), 'too-long');
    await expectCodecError(decodeSignal('1abc$def'), 'format');
    await expectCodecError(decodeSignal('2AAAA'), 'version');
    await expectCodecError(decodeSignal('1AAAAA'), 'format'); // nicht kanonisches base64url
    await expectCodecError(decodeSignal('1' + toBase64Url(new Uint8Array([1, 2, 3, 4, 5, 6]))), 'decompress');
  });

  it('schützt vor Decompression-Bombs (Limit nach der Dekompression)', async () => {
    const bomb = new Uint8Array(1024 * 1024).fill(0x41); // 1 MiB → komprimiert winzig
    const code = CODE_PREFIX + toBase64Url(await deflateRaw(bomb));
    expect(code.length).toBeLessThan(MAX_CODE_LENGTH);
    await expectCodecError(decodeSignal(code), 'too-large');
    const justOver = new Uint8Array(MAX_PAYLOAD_BYTES + 1).fill(0x20);
    await expectCodecError(decodeSignal(CODE_PREFIX + toBase64Url(await deflateRaw(justOver))), 'too-large');
  });

  it('prüft Version, Typ und Struktur des Payloads', async () => {
    const sdp = minimizeSdp(chromeOffer());
    const s = newSessionId();
    await expectCodecError(decodeSignal(await rawCode({ v: 2, t: 'o', s, d: sdp })), 'version');
    await expectCodecError(decodeSignal(await rawCode({ v: 1, t: 'x', s, d: sdp })), 'structure');
    await expectCodecError(decodeSignal(await rawCode({ v: 1, t: 'o', s: 'kurz', d: sdp })), 'structure');
    await expectCodecError(decodeSignal(await rawCode({ v: 1, t: 'o', s, d: sdp, extra: 1 })), 'structure');
    await expectCodecError(decodeSignal(await rawCode({ v: 1, t: 'o', s, d: 42 })), 'structure');
    await expectCodecError(decodeSignal(await rawCode([1, 2, 3])), 'structure');
    await expectCodecError(decodeSignal(await rawCode({ v: 1, t: 'a', s, d: sdp })), 'structure'); // Antwort mit actpass
    await expectCodecError(decodeSignal(await rawCode({ v: 1, t: 'o', s, d: 'v=0\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel' })), 'structure');
    const notJson = CODE_PREFIX + toBase64Url(await deflateRaw(utf8Encode('{kaputt')));
    await expectCodecError(decodeSignal(notJson), 'structure');
  });
});

describe('Links', () => {
  it('erkennt Einladungs- und Antwortlinks sowie reine Codes', async () => {
    const s = newSessionId();
    const offer = await encodeSignal({ version: 1, type: 'offer', sessionId: s, sdp: chromeOffer() });
    const answer = await encodeSignal({ version: 1, type: 'answer', sessionId: s, sdp: chromeAnswer() });
    expect(parseInput(`https://x.de/app/#i=${offer}`)).toEqual({ hint: 'offer', code: offer });
    expect(parseInput(`Hier: https://x.de/#a=${answer} danke`)).toEqual({ hint: 'answer', code: answer });
    expect(parseInput(`a=${answer}`)).toEqual({ hint: 'answer', code: answer });
    expect(parseInput(`  ${offer}  `)).toEqual({ hint: null, code: offer });
    expect((await decodeInput(offer)).type).toBe('offer');
    expect((await decodeInput(`https://x.de/#a=${answer}`)).type).toBe('answer');
  });

  it('lehnt Links ab, deren Typ nicht zum Inhalt passt', async () => {
    const offer = await encodeSignal({ version: 1, type: 'offer', sessionId: newSessionId(), sdp: chromeOffer() });
    await expectCodecError(decodeInput(`https://x.de/#a=${offer}`), 'structure');
    expect(() => parseInput('https://x.de/#foo=bar')).toThrow(CodecError);
  });

  it('baut Links nur mit Fragment, nie mit Query', () => {
    const link = buildLink('offer', '1abc', 'https://x.de/sub/');
    expect(link).toBe('https://x.de/sub/#i=1abc');
    expect(link).not.toContain('?');
  });

  it('extrahiert Fingerprints normalisiert', () => {
    const fp = fingerprint(9);
    expect(extractFingerprints(chromeOffer(fp.toLowerCase()))).toBe(`sha-256 ${fp}`);
  });
});
