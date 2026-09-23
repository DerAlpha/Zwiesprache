import { describe, expect, it } from 'vitest';
import { classifyPair, isLocalAddress } from '../src/rtc/stats';
import { buildRtcConfiguration, DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings/settings';
import { splitLinks } from '../src/ui/linkify';
import { fromBase64Url, toBase64Url } from '../src/util/bytes';

describe('base64url', () => {
  it('Roundtrip für alle Längen', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });
  it('lehnt ungültige Eingaben ab', () => {
    expect(() => fromBase64Url('ab+c')).toThrow();
    expect(() => fromBase64Url('abc=')).toThrow();
    expect(() => fromBase64Url('a')).toThrow();
    expect(() => fromBase64Url('AB')).toThrow(); // Restbits ≠ 0
  });
});

describe('Links im Text', () => {
  it('erkennt nur http(s)-Links', () => {
    expect(splitLinks('Schau: https://example.org/a?b=1. Danke')).toEqual([
      { type: 'text', value: 'Schau: ' },
      { type: 'link', value: 'https://example.org/a?b=1', href: 'https://example.org/a?b=1' },
      { type: 'text', value: '. Danke' },
    ]);
    expect(splitLinks('javascript:alert(1) data:text/html,x file:///etc')).toEqual([
      { type: 'text', value: 'javascript:alert(1) data:text/html,x file:///etc' },
    ]);
    expect(splitLinks('<b>kein html</b>')).toEqual([{ type: 'text', value: '<b>kein html</b>' }]);
  });
});

describe('Einstellungen', () => {
  it('Standard: zwei STUN-Server, kein Relay-Zwang', () => {
    const cfg = buildRtcConfiguration(DEFAULT_SETTINGS);
    expect(cfg.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]);
    expect(cfg.iceTransportPolicy).toBe('all');
  });

  it('Nur lokales Netzwerk: keine ICE-Server', () => {
    expect(buildRtcConfiguration({ ...DEFAULT_SETTINGS, networkMode: 'lan' }).iceServers).toEqual([]);
  });

  it('IP verbergen erzwingt Relay – auch ohne TURN (dann eben keine Verbindung statt IP-Leck)', () => {
    const withTurn = buildRtcConfiguration({ ...DEFAULT_SETTINGS, turnUrl: 'turn:t.example:3478', turnUsername: 'u', turnPassword: 'p', hideIp: true });
    expect(withTurn.iceTransportPolicy).toBe('relay');
    expect(withTurn.iceServers).toContainEqual({ urls: 'turn:t.example:3478', username: 'u', credential: 'p' });
    expect(buildRtcConfiguration({ ...DEFAULT_SETTINGS, hideIp: true }).iceTransportPolicy).toBe('relay');
  });

  it('übernimmt aus dem Speicher nur gültige Werte; Passwort nur mit "merken"', () => {
    const s = sanitizeSettings({
      networkMode: 'evil',
      stunUrls: ['stun:ok.example:3478', 'http://evil', 42],
      turnUrl: 'javascript:alert(1)',
      turnPassword: 'geheim',
      rememberTurnPassword: false,
    });
    expect(s.networkMode).toBe('internet');
    expect(s.stunUrls).toEqual(['stun:ok.example:3478']);
    expect(s.turnUrl).toBe('');
    expect(s.turnPassword).toBe('');
    expect(sanitizeSettings({ turnPassword: 'geheim', rememberTurnPassword: true }).turnPassword).toBe('geheim');
  });
});

describe('Verbindungsart', () => {
  it('klassifiziert Kandidatenpaare', () => {
    expect(classifyPair({ candidateType: 'host' }, { candidateType: 'host' })).toBe('lan');
    expect(classifyPair({ candidateType: 'host' }, { candidateType: 'prflx', address: '192.168.0.4' })).toBe('lan');
    expect(classifyPair({ candidateType: 'srflx' }, { candidateType: 'srflx' })).toBe('internet');
    expect(classifyPair({ candidateType: 'host' }, { candidateType: 'prflx', address: '203.0.113.5' })).toBe('internet');
    expect(classifyPair({ candidateType: 'relay' }, { candidateType: 'host' })).toBe('relay');
    expect(classifyPair(undefined, { candidateType: 'host' })).toBeNull();
  });
  it('erkennt lokale Adressen', () => {
    for (const a of ['10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.1', 'fe80::1', 'fd00::1', 'abc-123.local']) {
      expect(isLocalAddress(a)).toBe(true);
    }
    for (const a of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:db8::1']) {
      expect(isLocalAddress(a)).toBe(false);
    }
  });
});
