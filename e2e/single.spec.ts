import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { connect, readSafetyCode, setLanMode, watchContext } from './helpers';

test('Einzeldatei zwiesprache.html funktioniert lokal (file://) mit strikter CSP', async ({ browser }) => {
  const fileUrl = pathToFileURL(resolve('dist-single/zwiesprache.html')).href;
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostWatch = await watchContext(hostCtx);
  const guestWatch = await watchContext(guestCtx);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto(fileUrl);
  await setLanMode(host);
  await guest.goto(fileUrl);
  await setLanMode(guest);
  await guest.goto('about:blank');

  // Lokale Datei: Hinweis und "Nur Code kopieren" statt reiner Link-Weitergabe
  await expect(host.getByText('Links funktionieren nur')).toBeVisible();
  const { invite } = await connect(host, guest);
  expect(invite.startsWith('file://')).toBe(true);
  expect(guest.url()).not.toContain('#');

  expect(await readSafetyCode(host)).toBe(await readSafetyCode(guest));
  await host.keyboard.press('Escape');
  await guest.keyboard.press('Escape');

  await host.getByTestId('message-input').fill('Hallo aus der Einzeldatei');
  await host.getByTestId('message-input').press('Enter');
  await expect(guest.getByTestId('msg-in').last()).toContainText('Hallo aus der Einzeldatei');

  for (const w of [hostWatch, guestWatch]) {
    const nonFile = w.requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(nonFile).toEqual([]);
    expect(w.errors).toEqual([]);
  }
  await hostCtx.close();
  await guestCtx.close();
});
