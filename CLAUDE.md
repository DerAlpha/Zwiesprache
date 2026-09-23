# CLAUDE.md – Zwiesprache

Serverlose, sichere 1:1-Chat-Web-App. Nur statische Dateien; Nachrichten gehen per WebRTC-DataChannel
direkt von Browser zu Browser. Verbindungsaufbau über manuellen Austausch von Einladungs- und
Antwort-Link (bzw. Code/QR). Kein Login, keine Accounts, kein Backend.

## Befehle

```bash
npm install            # Abhängigkeiten (exakt gepinnt, package-lock.json ist committet)
npm run dev            # Dev-Server (ohne CSP, mit Debug-Logs)
npm run typecheck      # tsc --noEmit (strict)
npm test               # Vitest-Unit-Tests (tests/)
npm run test:e2e       # Playwright (e2e/) – baut dist/ + Einzeldatei und startet vite preview
npm run build          # dist/ (Mehrdatei, CSP per Meta-Tag) + SHA-256 aller Artefakte
npm run build:single   # dist-single/zwiesprache.html (alles inline, CSP mit Hashes) + SHA-256
npm run check          # typecheck + test + beide Builds
```

Nach jeder Änderung müssen `typecheck`, `test` und `build` grün sein; bei Änderungen am Verbindungs-
oder Chat-Ablauf zusätzlich `test:e2e`.

## Architektur

```
src/
  main.tsx              Einstieg: Controller erzeugen, Fragment auswerten, rendern
  i18n/de.ts            ALLE UI-Texte (Deutsch) – keine Strings in Komponenten hart kodieren
  signaling/            Codec (deflate-raw + base64url), SDP-Minimierung/-Validierung, Links (#i=/#a=),
                        QR-Matrix (uqr), BroadcastChannel-Übergabe von Antwort-Codes
  rtc/                  Peer (RTCPeerConnection + ausgehandelter DataChannel id 0), ICE-Gathering, getStats
  crypto/               cipher.ts (AES-256-GCM, Zähler-IV), secure-channel.ts (ECDH-Handshake, HKDF),
                        safety-code.ts (Sicherheitscode)
  protocol/             Nachrichtentypen + Schema-Validierung, Klartext-Frames, Rate-Limits
  files/                Chunking (16 KiB), Transfer (Backpressure, SHA-256), Magic-Byte-Erkennung
  settings/             Einstellungen (localStorage), RTCConfiguration
  chat/                 session.ts (Kanal → Krypto → Protokoll), controller.ts (App-Zustand + Abläufe)
  ui/                   Preact-Screens und -Komponenten, CSS (Variablen, Dark/Light)
build/csp.mjs           CSP-Definition (von vite.config.ts und scripts/single.mjs genutzt)
scripts/                hashes.mjs (SHA-256 der Artefakte), single.mjs (CSP-Hashes für Einzeldatei)
public/.htaccess        Optionale Apache-Header (landet in dist/)
tests/                  Vitest (Node, Web Crypto + CompressionStream)
e2e/                    Playwright (zwei Browser-Kontexte, LAN-Modus)
```

Datenfluss eingehend: `RTCDataChannel` → `Session.enqueue` (Größenlimit) → `SecureChannel.receive`
(Handshake bzw. AES-GCM mit strikt steigendem Zähler) → `decodeFrame` (JSON oder Chunk) →
`parseMessage` (Schema) → Rate-Limit → `Controller`.

Wire-Formate:
- Code: `"1"` + base64url(deflate-raw(JSON `{v:1,t:"o"|"a",s:<Session-ID>,d:<minimierte SDP>}`)).
- Kanal: `[0x00][Version][Rolle][65 B P-256-Public-Key]` (Handshake, Klartext) bzw.
  `[0x01][Zähler u64 BE][AES-GCM-Ciphertext+Tag]`; IV = 4 Nullbytes + Zähler; AAD = die 9 Header-Bytes.
- Klartext im Tunnel: `[0x01][JSON]` oder `[0x02][ID-Länge][ID][Index u32][Daten ≤ 16 KiB]`.
- Zähler `2^53-1` ist für das vorab verschlüsselte `bye` reserviert (synchron bei `pagehide`).

## Sicherheitsregeln (verbindlich)

- **100 % statisch**: kein eigener Server, keine Datenbank, keine Serverless-Functions, kein
  Signaling-Dienst (auch kein PeerJS-Broker), keine Analytics/Telemetrie, keine CDNs, keine Web-Fonts.
- Einzige externe Verbindung zur Laufzeit: STUN/TURN (konfigurierbar, abschaltbar).
- Läuft auf jedem HTTPS-Webspace, auch im Unterordner (`base: './'`), und als Einzeldatei lokal.
- Standard: **nichts speichern**. Nachrichten/Dateien nur im Speicher des Tabs. localStorage nur für
  Einstellungen; TURN-Passwort nur mit „merken“.
- **Keine eigene Krypto**. Nur Web Crypto API mit Standardkonstruktionen (ECDH P-256, HKDF-SHA-256,
  AES-256-GCM, SHA-256).
- Codes nur im URL-**Fragment** (`#i=`, `#a=`), nie im Query-String; Fragment sofort per
  `history.replaceState` entfernen.
- Eingehende Codes streng validieren: Länge vor und nach der Dekompression, Version, Typ, Struktur, SDP.
- Eine Einladung = genau eine Verbindung.
- Vor Abschluss des Handshakes keine Anwendungsnachrichten; alles (Text, Dateien, Tippen, Quittungen,
  bye) läuft durch die Verschlüsselungsschicht. Zähler strikt steigend, sonst verwerfen; ungültiger Tag → verwerfen.
- Sicherheitscode = SHA-256(Label, Host-Fingerprint, Gast-Fingerprint, Host-Key, Gast-Key) → 20 Ziffern.
- Alle eingehenden Daten sind untrusted: Schema-Validierung, Größenlimits (Text ≤ 10.000 Zeichen,
  JSON ≤ 64 KiB, Datei ≤ 200 MB), Rate-Limits.
- **Nie** `innerHTML` / `dangerouslySetInnerHTML`. Nachrichten nur als Text; Links nur http/https mit
  `rel="noopener noreferrer"`, keine Link-Vorschauen.
- Empfangene Dateien: Inline-Vorschau nur PNG/JPEG/GIF/WebP nach Magic-Byte-Prüfung; alles andere nur als
  Download mit `application/octet-stream`, nie im App-Origin öffnen. Blob-URLs freigeben.
- CSP per Meta-Tag im Production-Build (`default-src 'none'`, `script-src/style-src 'self'` bzw. Hashes,
  `img-src 'self' data: blob:`, `connect-src 'self'`, `object-src/base-uri/form-action 'none'`), kein
  `unsafe-inline`/`unsafe-eval`. Keine `style`-Attribute im Markup (Styles nur per Klasse oder CSSOM).
- Keine Nachrichteninhalte, Codes oder Schlüssel in der Konsole. `debug()` aus `src/util/log.ts` loggt nur im Dev-Modus.
- UI komplett Deutsch, alle Texte in `src/i18n/de.ts`.
- Abhängigkeiten exakt pinnen; neue nur mit Begründung (erlaubt: preact, @preact/preset-vite, uqr, jsqr;
  dev: vite, typescript, vitest, @playwright/test, vite-plugin-singlefile, @types/node, @babel/core als
  Peer-Dependency von @preact/preset-vite).

## Hinweise für Änderungen

- Zielbrowser: aktuelle Chrome/Edge, Firefox, Safari (macOS, iOS 16.4+), Android Chrome; mobile first.
- Neue Protokoll-Nachrichtentypen: in `protocol/messages.ts` (Typ + `parseMessage`) ergänzen; unbekannte
  Typen werden von älteren Versionen ignoriert.
- SDP-Minimierung nur um nachweislich optionale Zeilen erweitern (Begründung als Kommentar).
- Playwright nutzt das vorinstallierte Chromium (`PLAYWRIGHT_BROWSERS_PATH`) und startet es mit
  `--disable-features=WebRtcHideLocalIpsWithMdns`.
