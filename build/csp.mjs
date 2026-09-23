// Content-Security-Policy für den Production-Build (per Meta-Tag).
// Einzeldatei-Build: script-src/style-src enthalten die SHA-256-Hashes der Inline-Blöcke.

/** @type {Record<string, string[]>} */
export const CSP_BASE = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

/** @param {Record<string, string[]>} [overrides] */
export function buildCsp(overrides = {}) {
  return Object.entries({ ...CSP_BASE, ...overrides })
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** @param {string} csp */
export function cspMetaTag(csp) {
  return `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
}
