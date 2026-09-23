import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { encodeSignal, newSessionId } from '../src/signaling/codec';
import { buildLink } from '../src/signaling/links';
import { qrMatrix } from '../src/signaling/qr';
import { chromeOffer, randomFingerprint } from './fixtures';

/** Rendert die Matrix als RGBA-Bild (scale Pixel pro Modul) und liest sie mit jsQR wieder ein. */
function decode(text: string, scale = 4): string | null {
  const qr = qrMatrix(text);
  const px = qr.size * scale;
  const data = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dark = qr.modules[Math.floor(y / scale)]![Math.floor(x / scale)];
      const i = (y * px + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = dark ? 0 : 255;
      data[i + 3] = 255;
    }
  }
  return jsQR(data, px, px)?.data ?? null;
}

describe('QR-Code', () => {
  it('enthält den kompletten Einladungslink und ist lesbar', async () => {
    const code = await encodeSignal({ version: 1, type: 'offer', sessionId: newSessionId(), sdp: chromeOffer(randomFingerprint()) });
    const link = buildLink('offer', code, 'https://beispiel.de/zwiesprache/');
    expect(decode(link)).toBe(link);
  });

  it('erzeugt einen SVG-Pfad ohne HTML', () => {
    const qr = qrMatrix('https://beispiel.de/#i=1abc');
    expect(qr.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
    expect(qr.size).toBe(qr.modules.length);
  });
});
