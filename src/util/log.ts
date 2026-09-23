// Debug-Logging nur im Dev-Modus. Niemals Nachrichteninhalte, Codes oder Schlüssel loggen.

export function debug(...args: unknown[]): void {
  if (import.meta.env.DEV) console.debug('[zwiesprache]', ...args);
}
