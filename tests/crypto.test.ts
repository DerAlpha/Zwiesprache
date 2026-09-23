import { describe, expect, it } from 'vitest';
import { FINAL_COUNTER, HEADER_LENGTH, readCounter, ReceiveCipher, SendCipher } from '../src/crypto/cipher';
import { computeSafetyCode } from '../src/crypto/safety-code';
import {
  decodeHandshake,
  deriveSessionKeys,
  encodeHandshake,
  generateKeyPair,
  HandshakeError,
  SecureChannel,
} from '../src/crypto/secure-channel';
import { utf8Decode, utf8Encode } from '../src/util/bytes';
import { fingerprint } from './fixtures';

const HOST_FP = `sha-256 ${fingerprint(1)}`;
const GUEST_FP = `sha-256 ${fingerprint(2)}`;

async function keyPairFor() {
  const host = await generateKeyPair();
  const guest = await generateKeyPair();
  const common = { hostPublicKey: host.publicKey, guestPublicKey: guest.publicKey, hostFingerprint: HOST_FP, guestFingerprint: GUEST_FP };
  const hostKeys = await deriveSessionKeys({ ...common, role: 'host', privateKey: host.privateKey });
  const guestKeys = await deriveSessionKeys({ ...common, role: 'guest', privateKey: guest.privateKey });
  return { host, guest, hostKeys, guestKeys };
}

describe('Sicherheitscode', () => {
  const base = {
    hostFingerprint: HOST_FP,
    guestFingerprint: GUEST_FP,
    hostPublicKey: new Uint8Array(65).fill(4),
    guestPublicKey: new Uint8Array(65).fill(5),
  };

  it('ist deterministisch und hat 5 Viererblöcke', async () => {
    const a = await computeSafetyCode(base);
    const b = await computeSafetyCode({ ...base });
    expect(a).toBe(b);
    expect(a).toMatch(/^\d{4} \d{4} \d{4} \d{4} \d{4}$/);
  });

  it('ändert sich bei anderem Fingerprint oder Schlüssel', async () => {
    const ref = await computeSafetyCode(base);
    expect(await computeSafetyCode({ ...base, hostFingerprint: `sha-256 ${fingerprint(3)}` })).not.toBe(ref);
    expect(await computeSafetyCode({ ...base, guestFingerprint: `sha-256 ${fingerprint(4)}` })).not.toBe(ref);
    const otherKey = new Uint8Array(65).fill(4);
    otherKey[64] = 7;
    expect(await computeSafetyCode({ ...base, hostPublicKey: otherKey })).not.toBe(ref);
    expect(await computeSafetyCode({ ...base, guestPublicKey: otherKey })).not.toBe(ref);
  });

  it('hängt von der Reihenfolge Host/Gast ab', async () => {
    const ref = await computeSafetyCode(base);
    const swapped = await computeSafetyCode({
      hostFingerprint: base.guestFingerprint,
      guestFingerprint: base.hostFingerprint,
      hostPublicKey: base.guestPublicKey,
      guestPublicKey: base.hostPublicKey,
    });
    expect(swapped).not.toBe(ref);
  });
});

describe('Verschlüsselungsschicht', () => {
  it('Roundtrip in beide Richtungen', async () => {
    const { hostKeys, guestKeys } = await keyPairFor();
    const f1 = await hostKeys.send.seal(utf8Encode('Hallo Gast'));
    const r1 = await guestKeys.receive.open(f1);
    expect(r1.ok && utf8Decode(r1.plaintext)).toBe('Hallo Gast');
    const f2 = await guestKeys.send.seal(utf8Encode('Hallo Host'));
    const r2 = await hostKeys.receive.open(f2);
    expect(r2.ok && utf8Decode(r2.plaintext)).toBe('Hallo Host');
  });

  it('Zähler steigt strikt, IVs werden nie wiederverwendet', async () => {
    const { hostKeys } = await keyPairFor();
    const a = await hostKeys.send.seal(utf8Encode('a'));
    const b = await hostKeys.send.seal(utf8Encode('a'));
    expect(readCounter(a)).toBe(1);
    expect(readCounter(b)).toBe(2);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('lehnt Replays ab', async () => {
    const { hostKeys, guestKeys } = await keyPairFor();
    const f1 = await hostKeys.send.seal(utf8Encode('eins'));
    const f2 = await hostKeys.send.seal(utf8Encode('zwei'));
    expect((await guestKeys.receive.open(f1)).ok).toBe(true);
    expect(await guestKeys.receive.open(f1)).toEqual({ ok: false, reason: 'replay' });
    expect((await guestKeys.receive.open(f2)).ok).toBe(true);
    // Umordnung (alter Zähler nach neuerem) wird ebenfalls verworfen
    expect(await guestKeys.receive.open(f1)).toEqual({ ok: false, reason: 'replay' });
  });

  it('lehnt manipulierte Frames ab, ohne den Zähler zu verändern', async () => {
    const { hostKeys, guestKeys } = await keyPairFor();
    const frame = await hostKeys.send.seal(utf8Encode('geheim'));
    const tamperedBody = frame.slice();
    tamperedBody[HEADER_LENGTH + 2]! ^= 0x01;
    expect(await guestKeys.receive.open(tamperedBody)).toEqual({ ok: false, reason: 'auth' });
    const tamperedCounter = frame.slice();
    tamperedCounter[8]! ^= 0x10; // anderer Zähler → anderer IV/AAD → Tag ungültig
    expect(await guestKeys.receive.open(tamperedCounter)).toEqual({ ok: false, reason: 'auth' });
    // Original ist danach weiterhin gültig
    expect((await guestKeys.receive.open(frame)).ok).toBe(true);
  });

  it('Schlüssel sind pro Richtung verschieden und an die Rolle gebunden', async () => {
    const { hostKeys, guestKeys } = await keyPairFor();
    const fromHost = await hostKeys.send.seal(utf8Encode('x'));
    // Der Host kann seine eigenen Frames nicht mit dem Empfangsschlüssel öffnen (Reflexion)
    expect((await hostKeys.receive.open(fromHost)).ok).toBe(false);
    const fromGuest = await guestKeys.send.seal(utf8Encode('y'));
    expect((await guestKeys.receive.open(fromGuest)).ok).toBe(false);
  });

  it('Schlüssel hängen an den Fingerprints (anderes Transkript → nicht entschlüsselbar)', async () => {
    const host = await generateKeyPair();
    const guest = await generateKeyPair();
    const common = { hostPublicKey: host.publicKey, guestPublicKey: guest.publicKey, hostFingerprint: HOST_FP };
    const hostKeys = await deriveSessionKeys({ ...common, guestFingerprint: GUEST_FP, role: 'host', privateKey: host.privateKey });
    const guestKeys = await deriveSessionKeys({
      ...common,
      guestFingerprint: `sha-256 ${fingerprint(7)}`,
      role: 'guest',
      privateKey: guest.privateKey,
    });
    const frame = await hostKeys.send.seal(utf8Encode('x'));
    expect((await guestKeys.receive.open(frame)).ok).toBe(false);
  });

  it('Abschlussnachricht nutzt den reservierten Zähler, danach wird nichts mehr akzeptiert', async () => {
    const { hostKeys, guestKeys } = await keyPairFor();
    const final = await hostKeys.send.sealFinal(utf8Encode('bye'));
    expect(readCounter(final)).toBe(FINAL_COUNTER);
    const normal = await hostKeys.send.seal(utf8Encode('später'));
    expect((await guestKeys.receive.open(final)).ok).toBe(true);
    expect(await guestKeys.receive.open(normal)).toEqual({ ok: false, reason: 'replay' });
  });

  it('verwirft zu kurze oder fremde Frames', async () => {
    const { guestKeys } = await keyPairFor();
    expect(await guestKeys.receive.open(new Uint8Array(10))).toEqual({ ok: false, reason: 'format' });
    const other = new Uint8Array(40);
    other[0] = 0x07;
    expect(await guestKeys.receive.open(other)).toEqual({ ok: false, reason: 'format' });
  });
});

describe('Handshake', () => {
  it('kodiert/prüft den Handshake-Frame streng', async () => {
    const kp = await generateKeyPair();
    const frame = encodeHandshake('host', kp.publicKey);
    expect(decodeHandshake(frame, 'host')).toEqual(kp.publicKey);
    expect(() => decodeHandshake(frame, 'guest')).toThrow(HandshakeError);
    expect(() => decodeHandshake(frame.slice(0, 20), 'host')).toThrow(HandshakeError);
    const badVersion = frame.slice();
    badVersion[1] = 9;
    expect(() => decodeHandshake(badVersion, 'host')).toThrow(HandshakeError);
  });

  it('zwei SecureChannels einigen sich und berechnen denselben Sicherheitscode', async () => {
    const toGuest: Uint8Array[] = [];
    const toHost: Uint8Array[] = [];
    const host = new SecureChannel({ role: 'host', transmit: (f) => toGuest.push(f), localFingerprint: HOST_FP, remoteFingerprint: GUEST_FP });
    const guest = new SecureChannel({ role: 'guest', transmit: (f) => toHost.push(f), localFingerprint: GUEST_FP, remoteFingerprint: HOST_FP });
    await host.start();
    await guest.start();
    const rh = await host.receive(toHost.shift()!);
    const rg = await guest.receive(toGuest.shift()!);
    expect(rh.kind).toBe('handshake-done');
    expect(rg.kind).toBe('handshake-done');
    if (rh.kind !== 'handshake-done' || rg.kind !== 'handshake-done') return;
    expect(rh.info.safetyCode).toBe(rg.info.safetyCode);

    await host.send(utf8Encode('verschlüsselt'));
    const data = await guest.receive(toGuest.shift()!);
    expect(data.kind === 'data' && utf8Decode(data.plaintext)).toBe('verschlüsselt');
  });

  it('Man-in-the-Middle mit eigenen Schlüsseln ergibt unterschiedliche Codes', async () => {
    // Angreifer terminiert beide Seiten mit eigenem Zertifikat und eigenen Schlüsseln.
    const MITM_FP = `sha-256 ${fingerprint(8)}`;
    const a: Uint8Array[] = [];
    const b: Uint8Array[] = [];
    const m1: Uint8Array[] = [];
    const m2: Uint8Array[] = [];
    const host = new SecureChannel({ role: 'host', transmit: (f) => a.push(f), localFingerprint: HOST_FP, remoteFingerprint: MITM_FP });
    const mitmAsGuest = new SecureChannel({ role: 'guest', transmit: (f) => m1.push(f), localFingerprint: MITM_FP, remoteFingerprint: HOST_FP });
    const mitmAsHost = new SecureChannel({ role: 'host', transmit: (f) => m2.push(f), localFingerprint: MITM_FP, remoteFingerprint: GUEST_FP });
    const guest = new SecureChannel({ role: 'guest', transmit: (f) => b.push(f), localFingerprint: GUEST_FP, remoteFingerprint: MITM_FP });
    await Promise.all([host.start(), mitmAsGuest.start(), mitmAsHost.start(), guest.start()]);
    const h = await host.receive(m1.shift()!);
    const g = await guest.receive(m2.shift()!);
    if (h.kind !== 'handshake-done' || g.kind !== 'handshake-done') throw new Error('Handshake erwartet');
    expect(h.info.safetyCode).not.toBe(g.info.safetyCode);
  });

  it('keine Anwendungsdaten vor Abschluss des Handshakes', async () => {
    const { hostKeys } = await keyPairFor();
    const guest = new SecureChannel({ role: 'guest', transmit: () => undefined, localFingerprint: GUEST_FP, remoteFingerprint: HOST_FP });
    await guest.start();
    const frame = await hostKeys.send.seal(utf8Encode('zu früh'));
    await expect(guest.receive(frame)).rejects.toBeInstanceOf(HandshakeError);
    await expect(guest.send(utf8Encode('x'))).rejects.toBeInstanceOf(HandshakeError);
  });

  it('lehnt doppelte und reflektierte Handshakes ab', async () => {
    const out: Uint8Array[] = [];
    const host = new SecureChannel({ role: 'host', transmit: (f) => out.push(f), localFingerprint: HOST_FP, remoteFingerprint: GUEST_FP });
    await host.start();
    // Reflexion: eigener Handshake mit falscher Rolle → Rollenfehler
    await expect(host.receive(out[0]!)).rejects.toBeInstanceOf(HandshakeError);

    const host2 = new SecureChannel({ role: 'host', transmit: () => undefined, localFingerprint: HOST_FP, remoteFingerprint: GUEST_FP });
    await host2.start();
    const guestKp = await generateKeyPair();
    const hs = encodeHandshake('guest', guestKp.publicKey);
    await host2.receive(hs);
    await expect(host2.receive(hs)).rejects.toBeInstanceOf(HandshakeError);
  });

  it('lehnt ungültige Kurvenpunkte ab', async () => {
    const host = new SecureChannel({ role: 'host', transmit: () => undefined, localFingerprint: HOST_FP, remoteFingerprint: GUEST_FP });
    await host.start();
    const bogus = new Uint8Array(65).fill(1);
    bogus[0] = 0x04;
    await expect(host.receive(encodeHandshake('guest', bogus))).rejects.toBeInstanceOf(HandshakeError);
  });
});
