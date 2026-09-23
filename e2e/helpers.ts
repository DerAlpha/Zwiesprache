import { expect, type BrowserContext, type Page } from '@playwright/test';

export interface Watch {
  requests: string[];
  errors: string[];
}

/** Sammelt alle Requests, Seitenfehler und CSP-Verstöße eines Kontexts. */
export async function watchContext(ctx: BrowserContext): Promise<Watch> {
  const w: Watch = { requests: [], errors: [] };
  ctx.on('request', (r) => w.requests.push(r.url()));
  await ctx.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP-Verstoß: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  ctx.on('page', (p) => attachPage(p, w));
  return w;
}

export function attachPage(page: Page, w: Watch): void {
  page.on('console', (m) => {
    if (m.type() === 'error') w.errors.push(m.text());
  });
  page.on('pageerror', (e) => w.errors.push(String(e)));
}

/** Nur eigene statische Dateien (plus data:/blob:) – keine fremden Origins. */
export function expectOnlyOwnOrigin(w: Watch, origin: string): void {
  const foreign = w.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(foreign, `fremde Requests: ${foreign.join(', ')}`).toEqual([]);
}

export async function setLanMode(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByTestId('mode-lan').check();
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-save')).toHaveText(/Gespeichert/);
  await page.getByRole('button', { name: /Zurück/ }).click();
}

export async function readSafetyCode(page: Page): Promise<string> {
  await page.getByTestId('safety-badge').click();
  const code = ((await page.getByTestId('safety-code').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  return code;
}

/** Führt den kompletten Code-Austausch durch und gibt die Links zurück. */
export async function connect(host: Page, guest: Page): Promise<{ invite: string; answer: string }> {
  await host.getByTestId('start-host').click();
  const inviteField = host.getByTestId('invite-link');
  await expect(inviteField).toHaveValue(/#i=1[A-Za-z0-9_-]+$/);
  const invite = await inviteField.inputValue();

  await guest.goto(invite);
  const answerField = guest.getByTestId('answer-link');
  await expect(answerField).toHaveValue(/#a=1[A-Za-z0-9_-]+$/);
  const answer = await answerField.inputValue();

  await host.getByTestId('answer-input').fill(answer);
  await host.getByTestId('answer-submit').click();

  await expect(host.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  await expect(guest.getByTestId('chat-status')).toHaveAttribute('data-status', 'connected');
  return { invite, answer };
}
