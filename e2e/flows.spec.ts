import { expect, test, type Page } from '@playwright/test';
import { decodeSignal, encodeSignal } from '../src/signaling/codec';
import { connect, expectOnlyOwnOrigin, readSafetyCode, setLanMode, watchContext } from './helpers';

/** Ersetzt alle Kandidaten im Link durch eine unerreichbare Adresse (simuliert NAT/Firewall-Probleme). */
async function unreachable(link: string): Promise<string> {
  const hash = link.indexOf('#');
  const key = link.slice(hash + 1, hash + 2);
  const payload = await decodeSignal(link.slice(hash + 3));
  const sdp = payload.sdp.replace(/^(a=candidate:\S+ \d+ udp \d+ )\S+ \d+/gim, '$1198.51.100.7 9');
  return `${link.slice(0, hash)}#${key}=${await encodeSignal({ ...payload, sdp })}`;
}

async function lanPage(page: Page) {
  await page.goto('/');
  await setLanMode(page);
}

async function createInvite(page: Page): Promise<string> {
  await page.getByTestId('start-host').click();
  await expect(page.getByTestId('invite-link')).toHaveValue(/#i=/);
  return page.getByTestId('invite-link').inputValue();
}

async function answerFor(page: Page, invite: string): Promise<string> {
  await page.goto('about:blank');
  await page.goto(invite);
  await expect(page.getByTestId('answer-link')).toHaveValue(/#a=/);
  return page.getByTestId('answer-link').inputValue();
}

test('Fehlerfälle: falsche Einladung, Einladung statt Antwort, neu geladene Seite, bereits verwendet', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const other = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await lanPage(host);
  await lanPage(guest);

  // Zweite Einladung in einem anderen Tab → deren Antwort passt nicht zur ersten
  await other.goto('/');
  const inviteA = await createInvite(host);
  const inviteB = await createInvite(other);
  const answerB = await answerFor(guest, inviteB);

  await host.getByTestId('answer-input').fill(answerB);
  await host.getByTestId('answer-submit').click();
  await expect(host.getByTestId('setup-error')).toContainText('gehört zu einer anderen Einladung');

  // Einladung statt Antwort eingefügt
  await host.getByTestId('answer-input').fill(inviteA);
  await host.getByTestId('answer-submit').click();
  await expect(host.getByTestId('setup-error')).toContainText('Das ist eine Einladung');

  // Kaputter Code
  await host.getByTestId('answer-input').fill('https://example.org/#a=1kaputt');
  await host.getByTestId('answer-submit').click();
  await expect(host.getByTestId('setup-error')).toContainText(/beschädigt|gültig/);

  // Seite neu geladen → Einladung ungültig
  await other.reload();
  await other.getByTestId('start-paste').click();
  await other.getByTestId('paste-input').fill(answerB);
  await other.getByTestId('paste-submit').click();
  await expect(other.getByRole('alert')).toContainText('Einladung ungültig – Seite wurde neu geladen');

  // Richtige Antwort → verbunden; eine zweite Antwort auf dieselbe Einladung wird nicht angenommen
  const guest2Ctx = await browser.newContext();
  const guest2 = await guest2Ctx.newPage();
  await lanPage(guest2);
  const answerA = await answerFor(guest, inviteA);
  const answerA2 = await answerFor(guest2, inviteA);
  await host.getByTestId('answer-input').fill(answerA);
  await host.getByTestId('answer-submit').click();
  await expect(host.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  await expect(guest.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  // Eine zweite Antwort auf dieselbe Einladung wird nicht mehr angenommen (auch nicht per Übergabe)
  const second = await hostCtx.newPage();
  await second.goto(answerA2);
  await expect(second.getByTestId('handover-not-found')).toBeVisible();
  await expect(host.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  await expect(guest2.getByTestId('chat-status')).toHaveCount(0);

  await hostCtx.close();
  await guestCtx.close();
  await guest2Ctx.close();
});

test('Antwort-Link im selben Browser: Übergabe per BroadcastChannel', async ({ browser, baseURL }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostWatch = await watchContext(hostCtx);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await lanPage(host);
  await lanPage(guest);
  const invite = await createInvite(host);
  const answer = await answerFor(guest, invite);

  // Host öffnet den Antwort-Link in einem neuen Tab desselben Browsers
  const handoverTab = await hostCtx.newPage();
  await handoverTab.goto(answer);
  await expect(handoverTab.getByTestId('handover-done')).toContainText('Übergeben – du kannst diesen Tab schließen');
  expect(handoverTab.url()).not.toContain('#');
  await expect(host.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  await expect(guest.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');

  // Ohne wartenden Tab: verständlicher Hinweis + Code zum Kopieren
  const stray = await guestCtx.newPage();
  await stray.goto(answer);
  await expect(stray.getByTestId('handover-not-found')).toBeVisible();

  // Tab schließen (pagehide) sendet bye → Gegenüber sieht "beendet"
  await guest.close();
  await expect(host.getByTestId('chat-status')).toHaveAttribute('data-status', 'ended');

  expectOnlyOwnOrigin(hostWatch, new URL(baseURL!).origin);
  expect(hostWatch.errors).toEqual([]);
  await hostCtx.close();
  await guestCtx.close();
});

test('Verbindungsverlust: Reconnect per neuem Code-Austausch, Verlauf bleibt erhalten', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  // RTCPeerConnections mitschneiden, um einen Verbindungsabbruch zu simulieren
  await guestCtx.addInitScript(() => {
    const Orig = window.RTCPeerConnection;
    const list: RTCPeerConnection[] = [];
    (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = list;
    window.RTCPeerConnection = class extends Orig {
      constructor(config?: RTCConfiguration) {
        super(config);
        list.push(this);
      }
    } as typeof RTCPeerConnection;
  });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await lanPage(host);
  await lanPage(guest);
  await guest.goto('about:blank');
  await connect(host, guest);

  const code1 = await readSafetyCode(host);
  expect(await readSafetyCode(guest)).toBe(code1);
  await host.getByTestId('safety-verify').click();
  await guest.getByTestId('safety-verify').click();

  await host.getByTestId('message-input').fill('vor dem Abbruch');
  await host.getByTestId('message-input').press('Enter');
  await expect(guest.getByTestId('msg-in').last()).toContainText('vor dem Abbruch');

  // Verbindung hart kappen (ohne bye)
  await guest.evaluate(() => (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.at(-1)!.close());
  await expect(host.getByTestId('chat-status')).toHaveAttribute('data-status', 'lost', { timeout: 45_000 });
  await expect(host.getByTestId('chat-banner')).toContainText('Verbindung verloren');

  // Neu verbinden: Host erstellt neue Einladung, Gast fügt sie im bestehenden Tab ein
  await host.getByRole('button', { name: 'Neue Einladung erstellen' }).click();
  await expect(host.getByTestId('invite-link')).toHaveValue(/#i=/);
  const invite = await host.getByTestId('invite-link').inputValue();
  await expect(guest.getByTestId('chat-status')).toHaveAttribute('data-status', 'lost', { timeout: 45_000 });
  await guest.getByRole('button', { name: 'Einladung einfügen' }).click();
  await guest.getByTestId('paste-input').fill(invite);
  await guest.getByTestId('paste-submit').click();
  await expect(guest.getByTestId('answer-link')).toHaveValue(/#a=/);
  const answer = await guest.getByTestId('answer-link').inputValue();
  await host.getByTestId('answer-input').fill(answer);
  await host.getByTestId('answer-submit').click();

  await expect(host.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  await expect(guest.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  // Verlauf ist noch da
  await expect(guest.getByTestId('msg-in').first()).toContainText('vor dem Abbruch');
  await expect(host.getByTestId('msg-out').first()).toContainText('vor dem Abbruch');
  // Neue Schlüssel → neuer Code, beide Seiten wieder identisch; gleiche Zertifikate → Verifizierung bleibt
  const code2 = await readSafetyCode(host);
  expect(await readSafetyCode(guest)).toBe(code2);
  expect(code2).not.toBe(code1);
  await expect(host.getByTestId('safety-badge')).toHaveAttribute('data-verified', 'true');

  await guest.keyboard.press('Escape');
  await guest.getByTestId('message-input').fill('nach dem Reconnect');
  await guest.getByTestId('message-input').press('Enter');
  await expect(host.getByTestId('msg-in').last()).toContainText('nach dem Reconnect');

  await hostCtx.close();
  await guestCtx.close();
});

test('ICE scheitert: verständliche Meldung mit Lösungswegen', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await lanPage(host);
  await lanPage(guest);
  const invite = await unreachable(await createInvite(host));
  const answer = await unreachable(await answerFor(guest, invite));
  await host.getByTestId('answer-input').fill(answer);
  await host.getByTestId('answer-submit').click();
  const help = host.getByTestId('ice-failed');
  await expect(help).toBeVisible({ timeout: 75_000 });
  await expect(help).toContainText('selbe WLAN');
  await expect(help).toContainText('Hotspot');
  await expect(help).toContainText('TURN');
  await hostCtx.close();
  await guestCtx.close();
});

test('Seite "Wie sicher ist das?" erklärt Modell und Grenzen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Wie sicher ist das?' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wie sicher ist das?');
  for (const text of ['DTLS', 'AES-256-GCM', 'Sicherheitscode', 'IP-Adresse', 'Screenshots', 'SHA-256']) {
    await expect(page.locator('main')).toContainText(text);
  }
  await page.getByRole('button', { name: /Zurück/ }).click();
  await expect(page.getByTestId('start-host')).toBeVisible();
});
