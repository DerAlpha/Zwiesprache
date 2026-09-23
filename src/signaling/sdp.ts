// SDP-Minimierung und -Validierung für reine Datenkanal-Sitzungen.
//
// Entfernt werden nur Zeilen/Attribute, die für eine SCTP-Datenkanal-Sitzung ohne Trickle ICE
// nachweislich optional sind. Alles, was für ICE, DTLS oder SCTP gebraucht wird, bleibt unverändert.

export const MAX_SDP_LENGTH = 8000;
export const MAX_CANDIDATES = 12;

/**
 * Zeilen, die ohne Bedeutungsverlust entfallen können:
 * - a=extmap-allow-mixed: betrifft nur RTP-Header-Extensions (RFC 8285), der Datenkanal nutzt kein RTP.
 * - a=msid-semantic: betrifft nur Media-Streams (RFC 8830), hier gibt es keine.
 * - a=ice-options:trickle: kündigt Trickle ICE an (RFC 8840); wir tauschen alle Kandidaten auf einmal aus.
 * - a=sendrecv: ist laut RFC 4566/8866 ohnehin der Standardwert.
 */
const REMOVABLE_LINE_PATTERNS: readonly RegExp[] = [
  /^a=extmap-allow-mixed$/,
  /^a=msid-semantic:/,
  /^a=ice-options:trickle$/,
  /^a=sendrecv$/,
];

/**
 * Optionale Erweiterungsattribute von Kandidatenzeilen (RFC 8839 extension-att),
 * die nur Zusatzinformationen tragen und für die Konnektivität nicht nötig sind.
 */
const REMOVABLE_CANDIDATE_EXTENSIONS = new Set(['generation', 'ufrag', 'network-id', 'network-cost']);

interface ParsedCandidate {
  foundation: string;
  component: string;
  transport: string;
  priority: string;
  address: string;
  port: string;
  type: string;
  extensions: [string, string][];
}

function parseCandidate(line: string): ParsedCandidate | null {
  // a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> [<name> <value>]*
  const parts = line.slice('a=candidate:'.length).split(' ');
  if (parts.length < 8 || parts[6] !== 'typ') return null;
  const [foundation, component, transport, priority, address, port, , type] = parts as [
    string, string, string, string, string, string, string, string,
  ];
  const rest = parts.slice(8);
  if (rest.length % 2 !== 0) return null;
  const extensions: [string, string][] = [];
  for (let i = 0; i < rest.length; i += 2) extensions.push([rest[i]!, rest[i + 1]!]);
  return { foundation, component, transport, priority, address, port, type, extensions };
}

function formatCandidate(c: ParsedCandidate): string {
  let line = `a=candidate:${c.foundation} ${c.component} ${c.transport} ${c.priority} ${c.address} ${c.port} typ ${c.type}`;
  for (const [k, v] of c.extensions) line += ` ${k} ${v}`;
  return line;
}

/** Zerlegt SDP in Zeilen (ohne Zeilenende, ohne Leerzeilen). */
export function sdpLines(sdp: string): string[] {
  return sdp.split(/\r?\n/).filter((l) => l.length > 0);
}

/**
 * Minimiert eine lokale SDP für den Transport im Einladungs-/Antwortcode.
 * Ergebnis nutzt "\n" als Zeilentrenner; {@link restoreSdp} stellt CRLF wieder her.
 */
export function minimizeSdp(sdp: string, maxCandidates = MAX_CANDIDATES): string {
  const out: string[] = [];
  const seen = new Set<string>();
  let candidateCount = 0;
  for (const line of sdpLines(sdp)) {
    if (REMOVABLE_LINE_PATTERNS.some((re) => re.test(line))) continue;
    if (line.startsWith('a=candidate:')) {
      const c = parseCandidate(line);
      if (!c) continue;
      // Nur UDP: Datenkanäle brauchen kein ICE-TCP, und TCP-Kandidaten blähen den Code auf.
      if (c.transport.toLowerCase() !== 'udp') continue;
      const key = `${c.component}|${c.address.toLowerCase()}|${c.port}|${c.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (candidateCount >= maxCandidates) continue;
      candidateCount++;
      c.extensions = c.extensions
        .filter(([k]) => !REMOVABLE_CANDIDATE_EXTENSIONS.has(k))
        .map(([k, v]): [string, string] => {
          // Die "related address" ist nur informativ; wie Chrome sie selbst maskiert,
          // ersetzen wir sie, damit keine zusätzliche (lokale) IP im Code landet.
          if (k === 'raddr') return [k, '0.0.0.0'];
          if (k === 'rport') return [k, '0'];
          return [k, v];
        });
      out.push(formatCandidate(c));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Macht aus einer minimierten SDP wieder eine gültige SDP mit CRLF-Zeilenenden. */
export function restoreSdp(minimized: string): string {
  return sdpLines(minimized).join('\r\n') + '\r\n';
}

/** Normalisierte DTLS-Fingerprints ("sha-256 AB:CD:…"), sortiert und mit "\n" verbunden. */
export function extractFingerprints(sdp: string): string {
  const fps = new Set<string>();
  for (const line of sdpLines(sdp)) {
    const m = /^a=fingerprint:(\S+) ([0-9A-Fa-f:]+)$/.exec(line);
    if (m) fps.add(`${m[1]!.toLowerCase()} ${m[2]!.toUpperCase()}`);
  }
  return [...fps].sort().join('\n');
}

export type SdpKind = 'offer' | 'answer';

/**
 * Strikte Strukturprüfung einer empfangenen (untrusted) SDP.
 * Gibt eine Fehlerbeschreibung zurück oder null, wenn alles passt.
 */
export function validateRemoteSdp(sdp: string, kind: SdpKind): string | null {
  if (sdp.length === 0 || sdp.length > MAX_SDP_LENGTH) return 'Länge';
  const lines = sdpLines(sdp);
  if (lines[0] !== 'v=0') return 'Version';
  let mLines = 0;
  let candidates = 0;
  let ufrag = false;
  let pwd = false;
  let sha256 = false;
  let setup: string | null = null;
  for (const line of lines) {
    if (!/^[a-z]=[\x20-\x7e]*$/.test(line)) return 'Zeichen';
    if (line.startsWith('m=')) {
      mLines++;
      if (!/^m=application \d{1,5} UDP\/DTLS\/SCTP webrtc-datachannel$/.test(line)) return 'Medienzeile';
    } else if (line.startsWith('a=candidate:')) {
      candidates++;
      if (!parseCandidate(line)) return 'Kandidat';
    } else if (line.startsWith('a=ice-ufrag:')) {
      ufrag = /^a=ice-ufrag:[A-Za-z0-9+/]{4,256}$/.test(line);
    } else if (line.startsWith('a=ice-pwd:')) {
      pwd = /^a=ice-pwd:[A-Za-z0-9+/]{22,256}$/.test(line);
    } else if (line.startsWith('a=fingerprint:sha-256 ')) {
      sha256 = sha256 || /^a=fingerprint:sha-256 ([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(line);
    } else if (line.startsWith('a=setup:')) {
      setup = line.slice('a=setup:'.length);
    }
  }
  if (mLines !== 1) return 'Medienzeile';
  if (candidates > MAX_CANDIDATES * 2) return 'Kandidaten';
  if (!ufrag || !pwd) return 'ICE';
  if (!sha256) return 'Fingerprint';
  if (kind === 'offer' && setup !== 'actpass') return 'Setup';
  if (kind === 'answer' && setup !== 'active' && setup !== 'passive') return 'Setup';
  return null;
}
