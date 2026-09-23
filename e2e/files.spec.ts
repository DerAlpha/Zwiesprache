import { closeSync, openSync, ftruncateSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { connect, setLanMode } from './helpers';

/** Legt eine (dünn belegte) Datei der gewünschten Größe an. */
function sparseFile(name: string, size: number): string {
  const path = join(tmpdir(), `${process.pid}-${name}`);
  const fd = openSync(path, 'w');
  ftruncateSync(fd, size);
  closeSync(fd);
  return path;
}

test('Dateien: Limit 200 MB und Abbrechen durch den Empfänger', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await host.goto('/');
  await setLanMode(host);
  await guest.goto('/');
  await setLanMode(guest);
  await guest.goto('about:blank');
  await connect(host, guest);

  const tooBig = sparseFile('zu-gross.bin', 200 * 1024 * 1024 + 1);
  const big = sparseFile('gross.bin', 190 * 1024 * 1024);
  try {
    await host.getByTestId('file-input').setInputFiles(tooBig);
    await expect(host.getByRole('alert')).toContainText('zu groß');
    await expect(guest.getByTestId('file-item')).toHaveCount(0);

    await host.getByTestId('file-input').setInputFiles(big);
    const incoming = guest.getByTestId('file-item').last();
    await expect(incoming).toHaveAttribute('data-state', 'transferring');
    await incoming.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(incoming).toHaveAttribute('data-state', 'cancelled');
    await expect(host.getByTestId('file-item').last()).toHaveAttribute('data-state', 'cancelled');

    // Danach funktioniert der Chat weiter
    await guest.getByTestId('message-input').fill('noch da?');
    await guest.getByTestId('message-input').press('Enter');
    await expect(host.getByTestId('msg-in').last()).toContainText('noch da?');
  } finally {
    rmSync(tooBig, { force: true });
    rmSync(big, { force: true });
  }
  await hostCtx.close();
  await guestCtx.close();
});
