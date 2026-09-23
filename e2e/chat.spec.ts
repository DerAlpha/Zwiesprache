import { expect, test } from '@playwright/test';
import { connect, expectOnlyOwnOrigin, readSafetyCode, setLanMode, watchContext } from './helpers';

// Kleines gültiges PNG (1×1 Pixel)
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('Code-Austausch, Nachrichten und Dateien in beide Richtungen, identischer Sicherheitscode', async ({ browser, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostWatch = await watchContext(hostCtx);
  const guestWatch = await watchContext(guestCtx);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  // Beide Seiten im Modus "Nur lokales Netzwerk" (ohne STUN)
  await host.goto('/');
  await setLanMode(host);
  await guest.goto('/');
  await setLanMode(guest);
  await guest.goto('about:blank');

  const { invite, answer } = await connect(host, guest);
  expect(invite.length, 'Einladungslink sollte kurz genug für QR sein').toBeLessThan(1000);
  expect(invite).not.toContain('?');
  expect(answer).toContain('#a=');
  // Fragment wurde beim Gast sofort aus der URL entfernt
  expect(guest.url()).not.toContain('#');

  // Verbindungsart
  await expect(host.getByTestId('connection-type')).toContainText('Direkt (lokal)');

  // Sicherheitscode auf beiden Seiten identisch
  const hostCode = await readSafetyCode(host);
  const guestCode = await readSafetyCode(guest);
  expect(hostCode).toMatch(/^\d{4} \d{4} \d{4} \d{4} \d{4}$/);
  expect(hostCode).toBe(guestCode);
  await host.getByTestId('safety-verify').click();
  await guest.getByTestId('safety-verify').click();
  await expect(host.getByTestId('safety-badge')).toHaveAttribute('data-verified', 'true');
  await expect(guest.getByTestId('safety-badge')).toHaveAttribute('data-verified', 'true');

  // Text: Host → Gast (Enter sendet)
  await host.getByTestId('message-input').fill('Hallo vom Host');
  await host.getByTestId('message-input').press('Enter');
  await expect(guest.getByTestId('msg-in').getByTestId('msg-text')).toHaveText('Hallo vom Host');
  await expect(host.getByTestId('msg-out').last().getByTestId('msg-status')).toHaveAttribute('data-status', 'delivered');

  // Tipp-Indikator
  await guest.getByTestId('message-input').pressSequentially('Moment');
  await expect(host.getByTestId('typing')).toContainText('schreibt');

  // Text: Gast → Host, mehrzeilig (Shift+Enter)
  await guest.getByTestId('message-input').fill('Zeile 1');
  await guest.getByTestId('message-input').press('Shift+Enter');
  await guest.getByTestId('message-input').pressSequentially('Zeile 2');
  await guest.getByTestId('send-button').click();
  await expect(host.getByTestId('msg-in').last().getByTestId('msg-text')).toHaveText('Zeile 1\nZeile 2');
  await expect(host.getByTestId('typing')).not.toContainText('schreibt');

  // HTML wird nie interpretiert, Links nur http(s) mit noopener/noreferrer
  await host.getByTestId('message-input').fill('<img src=x onerror="document.title=1"> https://example.org/pfad javascript:alert(1)');
  await host.getByTestId('send-button').click();
  const last = guest.getByTestId('msg-in').last();
  await expect(last.getByTestId('msg-text')).toContainText('<img src=x onerror="document.title=1">');
  await expect(last.locator('img')).toHaveCount(0);
  const link = last.getByRole('link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://example.org/pfad');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  // Datei: Host → Gast (Text, kein Bild → nur Download)
  const text = 'Datei-Inhalt äöü ✓\n'.repeat(2000);
  await host.getByTestId('file-input').setInputFiles({ name: 'hallo.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  const inFile = guest.getByTestId('file-item').last();
  await expect(inFile).toHaveAttribute('data-state', 'done');
  await expect(inFile.getByTestId('file-name')).toHaveText('hallo.txt');
  await expect(inFile.locator('img')).toHaveCount(0);
  const [download] = await Promise.all([guest.waitForEvent('download'), inFile.getByTestId('file-download').click()]);
  expect(download.suggestedFilename()).toBe('hallo.txt');
  const downloaded = await download.createReadStream().then(async (s) => {
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  });
  expect(downloaded).toBe(text);
  await expect(host.getByTestId('file-item').last()).toHaveAttribute('data-state', 'done');
  await expect(host.getByTestId('msg-out').last().getByTestId('msg-status')).toHaveAttribute('data-status', 'delivered');

  // Datei: Gast → Host (Bild mit Vorschau) und größere Binärdatei (viele Chunks)
  await guest.getByTestId('file-input').setInputFiles({ name: 'bild.png', mimeType: 'image/png', buffer: PNG_1PX });
  const inImage = host.getByTestId('file-item').last();
  await expect(inImage).toHaveAttribute('data-state', 'done');
  await expect(inImage.locator('img.file-preview')).toHaveAttribute('src', /^blob:/);

  const big = Buffer.alloc(600 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7919) % 251;
  await guest.getByTestId('file-input').setInputFiles({ name: 'daten.bin', mimeType: 'application/octet-stream', buffer: big });
  const inBig = host.getByTestId('file-item').last();
  await expect(inBig.getByTestId('file-name')).toHaveText('daten.bin');
  await expect(inBig).toHaveAttribute('data-state', 'done');
  const [dl2] = await Promise.all([host.waitForEvent('download'), inBig.getByTestId('file-download').click()]);
  const bigDownloaded = await dl2.createReadStream().then(async (s) => {
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  });
  expect(bigDownloaded.equals(big)).toBe(true);

  // Chat beenden: Gegenüber sieht den Hinweis
  await host.getByTestId('chat-menu').click();
  await host.getByTestId('end-chat').click();
  await host.getByTestId('end-confirm').click();
  await expect(host.getByTestId('start-host')).toBeVisible();
  await expect(guest.getByTestId('chat-status')).toHaveAttribute('data-status', 'ended');
  await expect(guest.getByTestId('chat-banner')).toContainText('beendet');

  // Keine fremden Requests, keine CSP-Verstöße oder Fehler
  expectOnlyOwnOrigin(hostWatch, origin);
  expectOnlyOwnOrigin(guestWatch, origin);
  expect(hostWatch.errors).toEqual([]);
  expect(guestWatch.errors).toEqual([]);

  await hostCtx.close();
  await guestCtx.close();
});
