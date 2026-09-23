import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { qrMatrix } from '../src/signaling/qr';
import { setLanMode } from './helpers';

/** Schreibt ein Y4M-Video (Graustufen) mit dem QR-Code von `text` – Futter für die Fake-Kamera. */
function writeQrVideo(path: string, text: string): void {
  const W = 720;
  const H = 720;
  const qr = qrMatrix(text);
  const scale = Math.floor(Math.min(W, H) / qr.size);
  const offX = Math.floor((W - qr.size * scale) / 2);
  const offY = Math.floor((H - qr.size * scale) / 2);
  const y = Buffer.alloc(W * H, 235);
  for (let py = 0; py < qr.size * scale; py++) {
    for (let px = 0; px < qr.size * scale; px++) {
      if (qr.modules[Math.floor(py / scale)]![Math.floor(px / scale)]) y[(offY + py) * W + offX + px] = 16;
    }
  }
  const uv = Buffer.alloc((W / 2) * (H / 2), 128);
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv, uv]);
  writeFileSync(path, Buffer.concat([header, frame, frame, frame]));
}

test('Antwort per QR-Code scannen (Fake-Kamera, jsQR-Fallback unter CSP)', async ({ browser, baseURL }) => {
  const video = join(tmpdir(), `zwiesprache-qr-${process.pid}.y4m`);
  writeFileSync(video, '');
  // Eigener Browser für den Host mit Fake-Kamera, die später das QR-Video abspielt.
  const scanBrowser = await chromium.launch({
    args: [
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--allow-loopback-in-peer-connection',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  const hostCtx = await scanBrowser.newContext({ baseURL });
  await hostCtx.grantPermissions(['camera']);
  const errors: string[] = [];
  const host = await hostCtx.newPage();
  host.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();

  await host.goto('/');
  await setLanMode(host);
  await guest.goto('/');
  await setLanMode(guest);

  await host.getByTestId('start-host').click();
  await expect(host.getByTestId('invite-link')).toHaveValue(/#i=/);
  // QR-Code der Einladung wird angezeigt
  await host.getByRole('button', { name: 'QR-Code zeigen' }).click();
  await expect(host.getByTestId('qr-code')).toBeVisible();
  const invite = await host.getByTestId('invite-link').inputValue();

  await guest.goto('about:blank');
  await guest.goto(invite);
  await expect(guest.getByTestId('answer-link')).toHaveValue(/#a=/);
  const answer = await guest.getByTestId('answer-link').inputValue();

  writeQrVideo(video, answer);
  await host.getByRole('button', { name: 'QR scannen' }).click();
  await expect(host.getByTestId('scanner')).toBeVisible();

  await expect(host.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected', { timeout: 30_000 });
  await expect(guest.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  expect(errors).toEqual([]);

  await scanBrowser.close();
  await guestCtx.close();
});
