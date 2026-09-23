// Komfort: Öffnet der Host den Antwort-Link im selben Browser, reicht der neue Tab den Code per
// BroadcastChannel (nur gleicher Origin) an den wartenden Tab weiter.

import { randomId } from '../util/bytes';

const CHANNEL_NAME = 'zwiesprache-handover-v1';
export const HANDOVER_TIMEOUT_MS = 1500;

type HandoverMessage = { type: 'answer'; nonce: string; code: string } | { type: 'claimed'; nonce: string };

function isHandoverMessage(x: unknown): x is HandoverMessage {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  if (typeof m.nonce !== 'string' || m.nonce.length > 64) return false;
  if (m.type === 'claimed') return true;
  return m.type === 'answer' && typeof m.code === 'string' && m.code.length <= 8192;
}

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    return null; // z. B. file:// mit opakem Origin
  }
}

/**
 * Wartender Host-Tab: nimmt Antworten entgegen. `accept` prüft (ohne Seiteneffekte), ob die Antwort
 * zur offenen Einladung passt; `apply` übernimmt sie. Gibt eine Abmeldefunktion zurück.
 */
export function listenForAnswers(accept: (code: string) => Promise<boolean>, apply: (code: string) => void): () => void {
  const channel = openChannel();
  if (!channel) return () => undefined;
  channel.onmessage = async (e: MessageEvent) => {
    const msg: unknown = e.data;
    if (!isHandoverMessage(msg) || msg.type !== 'answer') return;
    if (!(await accept(msg.code))) return;
    channel.postMessage({ type: 'claimed', nonce: msg.nonce } satisfies HandoverMessage);
    apply(msg.code);
  };
  return () => channel.close();
}

/** Neuer Tab: bietet den Antwort-Code an. true, wenn ein wartender Tab ihn übernommen hat. */
export function handOverAnswer(code: string, timeoutMs = HANDOVER_TIMEOUT_MS): Promise<boolean> {
  const channel = openChannel();
  if (!channel) return Promise.resolve(false);
  const nonce = randomId(12);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      channel.close();
      resolve(false);
    }, timeoutMs);
    channel.onmessage = (e: MessageEvent) => {
      const msg: unknown = e.data;
      if (isHandoverMessage(msg) && msg.type === 'claimed' && msg.nonce === nonce) {
        clearTimeout(timer);
        channel.close();
        resolve(true);
      }
    };
    channel.postMessage({ type: 'answer', nonce, code } satisfies HandoverMessage);
  });
}
