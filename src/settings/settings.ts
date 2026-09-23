// Einstellungen (localStorage). Das TURN-Passwort wird nur gespeichert, wenn "merken" aktiv ist;
// sonst lebt es nur im Speicher dieses Tabs.

export type NetworkMode = 'internet' | 'lan';

export interface Settings {
  networkMode: NetworkMode;
  stunUrls: string[];
  turnUrl: string;
  turnUsername: string;
  turnPassword: string;
  rememberTurnPassword: boolean;
  hideIp: boolean;
  sound: boolean;
}

export const DEFAULT_STUN_URLS: readonly string[] = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  networkMode: 'internet',
  stunUrls: [...DEFAULT_STUN_URLS],
  turnUrl: '',
  turnUsername: '',
  turnPassword: '',
  rememberTurnPassword: false,
  hideIp: false,
  sound: false,
};

const STORAGE_KEY = 'zwiesprache.settings.v1';
const MAX_URLS = 8;
const MAX_FIELD = 512;

const STUN_RE = /^stuns?:[^\s?#]+(\?[^\s#]*)?$/;
const TURN_RE = /^turns?:[^\s?#]+(\?transport=(udp|tcp))?$/;

export function isValidStunUrl(url: string): boolean {
  return url.length <= MAX_FIELD && STUN_RE.test(url);
}

export function isValidTurnUrl(url: string): boolean {
  return url.length <= MAX_FIELD && TURN_RE.test(url);
}

export function hasTurn(s: Settings): boolean {
  return s.turnUrl.length > 0 && isValidTurnUrl(s.turnUrl);
}

/** Übernimmt nur gültige Felder aus einem (untrusted) gespeicherten Objekt. */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, stunUrls: [...DEFAULT_SETTINGS.stunUrls] };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  if (r.networkMode === 'internet' || r.networkMode === 'lan') s.networkMode = r.networkMode;
  if (Array.isArray(r.stunUrls)) {
    s.stunUrls = r.stunUrls.filter((u): u is string => typeof u === 'string' && isValidStunUrl(u)).slice(0, MAX_URLS);
  }
  if (typeof r.turnUrl === 'string' && (r.turnUrl === '' || isValidTurnUrl(r.turnUrl))) s.turnUrl = r.turnUrl;
  if (typeof r.turnUsername === 'string') s.turnUsername = r.turnUsername.slice(0, MAX_FIELD);
  if (typeof r.rememberTurnPassword === 'boolean') s.rememberTurnPassword = r.rememberTurnPassword;
  if (s.rememberTurnPassword && typeof r.turnPassword === 'string') s.turnPassword = r.turnPassword.slice(0, MAX_FIELD);
  if (typeof r.hideIp === 'boolean') s.hideIp = r.hideIp;
  if (typeof r.sound === 'boolean') s.sound = r.sound;
  return s;
}

let memoryPassword = '';

export function loadSettings(): Settings {
  let s: Settings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    s = sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    s = sanitizeSettings(null);
  }
  if (!s.rememberTurnPassword) s.turnPassword = memoryPassword;
  return s;
}

export function saveSettings(s: Settings): void {
  memoryPassword = s.turnPassword;
  const stored: Partial<Settings> = { ...s };
  if (!s.rememberTurnPassword) delete stored.turnPassword;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Speicher nicht verfügbar (z. B. privater Modus): Einstellungen gelten nur für diesen Tab.
  }
}

/** Baut die RTCConfiguration aus den Einstellungen. */
export function buildRtcConfiguration(s: Settings, certificate?: RTCCertificate): RTCConfiguration {
  const config: RTCConfiguration = {
    iceServers: [],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
  if (certificate) config.certificates = [certificate];
  if (s.networkMode === 'lan') return config;
  const servers: RTCIceServer[] = [];
  const stun = s.stunUrls.filter(isValidStunUrl);
  if (stun.length > 0) servers.push({ urls: stun });
  if (hasTurn(s)) {
    servers.push({ urls: s.turnUrl, username: s.turnUsername, credential: s.turnPassword });
  }
  // "IP verbergen" nie stillschweigend aufweichen: ohne TURN gibt es dann eben keine Kandidaten.
  if (s.hideIp) config.iceTransportPolicy = 'relay';
  config.iceServers = servers;
  return config;
}
