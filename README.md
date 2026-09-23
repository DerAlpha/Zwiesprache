# Zwiesprache

**Serverloser, verschlüsselter 1:1-Chat direkt von Gerät zu Gerät.**

Zwiesprache besteht nur aus statischen Dateien. Nachrichten und Dateien gehen per WebRTC direkt
zwischen zwei Browsern hin und her. Den Verbindungsaufbau erledigt ihr selbst: Einladungslink
schicken, Antwort-Link zurückbekommen, einfügen – fertig. Kein Login, keine Accounts, kein Backend,
keine Telemetrie. Schließt du den Tab, ist alles weg.

## Funktionen

- Verbindungsaufbau per Einladungs- und Antwort-Link (Kopieren, Web Share oder QR-Code), ohne Signaling-Server
- Zwei Verschlüsselungsschichten: DTLS (WebRTC) + zusätzlich ECDH P-256 → HKDF-SHA-256 → AES-256-GCM
- 20-stelliger Sicherheitscode gegen Man-in-the-Middle, „Verifiziert“-Badge
- Textnachrichten (mehrzeilig), Zeitstempel, Status gesendet/zugestellt, Tipp-Anzeige
- Dateien und Bilder bis 200 MB (16-KiB-Chunks, Backpressure, Fortschritt, Abbrechen, SHA-256-Prüfung)
- Anzeige der Verbindungsart: „Direkt (lokal)“, „Direkt (Internet)“, „Über Relay“
- Reconnect per neuem Code-Austausch, der Verlauf bleibt im Tab erhalten
- Einstellungen: eigene STUN/TURN-Server, „Nur lokales Netzwerk“, „IP verbergen“ (nur über TURN)
- Ungelesen-Zähler im Tab-Titel, optionaler Benachrichtigungston
- Deutsch, mobile first, Dark/Light nach Systemeinstellung, barrierearm (Tastatur, aria-live)
- Läuft auf jedem HTTPS-Webspace (auch im Unterordner) oder als einzelne HTML-Datei lokal

## So funktioniert’s

1. **Host:** „Neuen Chat starten“ → die App erzeugt einen Einladungslink `https://…/#i=CODE`.
   Teilen per Kopieren, Teilen-Dialog oder QR-Code (der QR enthält den kompletten Link, die normale
   Handykamera öffnet ihn direkt). Der Host-Tab bleibt offen, bis die Verbindung steht.
2. **Gast:** öffnet den Link. Die App liest den Code aus dem Fragment, entfernt ihn sofort aus Adresszeile
   und Verlauf und erzeugt einen Antwort-Link `https://…/#a=CODE` zum Zurückschicken.
3. **Host:** fügt die Antwort ein (Textfeld, „Aus Zwischenablage einfügen“ oder QR scannen) → verbunden.
   Öffnet der Host den Antwort-Link im selben Browser, übergibt der neue Tab den Code automatisch an den
   wartenden Tab („Übergeben – du kannst diesen Tab schließen“).
4. Beide vergleichen den **Sicherheitscode** am Telefon oder persönlich und tippen auf „Verifiziert“.

## Deployment

### Webspace (Mehrdatei-Build)

```bash
npm ci
npm run build        # → dist/  (gibt SHA-256 aller Dateien aus, schreibt dist/SHA256SUMS)
```

Den **Inhalt** von `dist/` auf einen beliebigen HTTPS-Webspace hochladen – gern in einen Unterordner
(`base: './'`, alle Pfade sind relativ). Es wird kein Server-Code benötigt.

- HTTPS ist Pflicht (WebRTC, Web Crypto und Kamera brauchen einen sicheren Kontext).
- `dist/index.html` enthält eine strikte Content-Security-Policy als Meta-Tag und `Referrer-Policy: no-referrer`.
- Optional (Apache): `dist/.htaccess` setzt dieselben Regeln als HTTP-Header und zusätzlich
  `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` (Kamera nur für die
  eigene Seite, Rest aus), HTTPS-Umleitung und sinnvolle Cache-Header. Erfordert `mod_headers`
  (und für die Umleitung `mod_rewrite`). Bei anderen Webservern (nginx, Caddy …) die Header analog setzen.

### Einzeldatei (lokal nutzbar)

```bash
npm run build:single # → dist-single/zwiesprache.html (+ SHA256SUMS)
```

`zwiesprache.html` enthält alles inline (JS, CSS) mit einer CSP aus SHA-256-Hashes der Inline-Blöcke –
ohne `unsafe-inline`. Die Datei funktioniert per Doppelklick lokal (`file://`) oder auf jedem Webspace.
Bei lokal geöffneter Datei sind Links nur auf Geräten mit derselben Datei nutzbar; die App bietet dann
„Nur Code kopieren“ an, und der QR-Code enthält den Code statt des Links.

### Integrität prüfen

Die Builds sind reproduzierbar (gleicher Quellstand + `package-lock.json` + Node-Version ⇒ gleiche
Prüfsummen). Wer dem Webspace nicht vertrauen will, veröffentlicht die SHA-256 der Einzeldatei an
separater Stelle und prüft vor der Nutzung:

```bash
sha256sum zwiesprache.html          # Linux
shasum -a 256 zwiesprache.html      # macOS
certutil -hashfile zwiesprache.html SHA256   # Windows
```

## Sicherheitsmodell

| Schicht | Was | Schützt gegen |
| --- | --- | --- |
| Codes im URL-Fragment | Einladung/Antwort nur hinter `#`, sofort per `history.replaceState` entfernt | Webserver-Logs, Referrer, Verlauf |
| DTLS | vom Browser erzwungene Transportverschlüsselung des DataChannels | Mitlesen im Netz |
| Zusatzschicht | ephemeres ECDH P-256 → HKDF-SHA-256 (Salt = Transkript-Hash über beide DTLS-Fingerprints und beide Public Keys) → je ein AES-256-GCM-Schlüssel pro Richtung, an die Rolle Host/Gast gebunden; IV = 96-Bit-Zähler, strikt steigend | Defense in Depth, Replay, Manipulation, Reflexion |
| Sicherheitscode | SHA-256(Label, Host-Fingerprint, Gast-Fingerprint, Host-Key, Gast-Key) → 5×4 Ziffern | Man-in-the-Middle beim Code-Austausch |
| Eingangsprüfung | Längenlimits vor/nach Dekompression, strikte Schema-Validierung, Rate-Limits, Größenlimits (10.000 Zeichen, 200 MB) | Decompression-Bombs, Speicher-/CPU-Missbrauch |
| Darstellung | nur Text (Preact escaped), keine `innerHTML`, Links nur http/https mit `rel="noopener noreferrer"`, keine Vorschauen | XSS, Tracking |
| Dateien | Vorschau nur PNG/JPEG/GIF/WebP nach Magic-Byte-Prüfung, alles andere nur als Download (`application/octet-stream`) | aktive Inhalte (SVG/HTML) im App-Origin |
| CSP | `default-src 'none'`, Skripte/Styles nur `'self'` bzw. Hashes, `connect-src 'self'`, kein `unsafe-*` | eingeschleusten Code, Datenabfluss |

Weitere Punkte:

- Vor Abschluss des Handshakes werden keine Anwendungsnachrichten akzeptiert; Text, Dateien, Tipp-Anzeige,
  Quittungen und `bye` laufen ausnahmslos durch die Zusatzschicht.
- Eine Einladung gilt für genau eine Verbindung; die Antwort enthält die Session-ID der Einladung
  („gehört zu einer anderen Einladung“, „Einladung ungültig – Seite wurde neu geladen“).
- Pro Tab wird ein DTLS-Zertifikat erzeugt. Bei einem Reconnect mit unveränderten Zertifikaten bleibt eine
  Verifizierung gültig (ein Angreifer kann das Zertifikat des Gegenübers nicht vorweisen); die ECDH-Schlüssel
  und damit der angezeigte Code sind trotzdem neu.
- Einzige Laufzeitverbindung außer den eigenen Dateien: STUN/TURN (Standard:
  `stun:stun.cloudflare.com:3478`, `stun:stun.l.google.com:19302`; änderbar, abschaltbar).
- Gespeichert werden nur Einstellungen (localStorage); das TURN-Passwort nur mit „merken“.
- Keine eigene Kryptografie – ausschließlich Web Crypto API.

## Grenzen

- **IP-Adresse:** Einladungs- und Antwort-Code enthalten die IP-Adressen der Geräte (sichtbar für das
  Gegenüber und jeden, der Link/Code sieht, z. B. den Messenger). Abhilfe: eigener TURN-Server + „IP verbergen“.
- **Screenshots / Weitergabe** durch das Gegenüber lassen sich technisch nicht verhindern.
- **Kompromittiertes Gerät** (Schadsoftware, bösartige Erweiterungen) kann alles mitlesen.
- **Manipulierter Webspace** könnte veränderten Code ausliefern → Einzeldatei mit veröffentlichter SHA-256 nutzen.
- **Metadaten** (wer wann mit welcher IP verbunden ist) sind für Netzbetreiber und STUN/TURN-Server sichtbar.
- **Kein Offline-Versand:** Beide müssen gleichzeitig online sein; der Host-Tab muss bis zur Verbindung offen bleiben.
- **NAT:** Ohne TURN scheitert die Verbindung manchmal (typisch Mobilfunk/CGNAT, symmetrische NATs).
  Lösungen: gleiches WLAN, Hotspot, TURN-Server eintragen.
- **Große Dateien** werden im Arbeitsspeicher gehalten (Limit 200 MB); auf schwachen Mobilgeräten kann das knapp werden.

## Netzwerk & Einstellungen

- **Internet (Standard):** STUN-Server ermitteln die öffentliche Adresse.
- **Nur lokales Netzwerk:** ohne STUN; funktioniert, wenn beide im selben Netz sind.
- **TURN (optional):** URL (`turn:`/`turns:`), Benutzername, Passwort. Leitet die (weiterhin doppelt
  verschlüsselten) Daten weiter, wenn keine direkte Verbindung möglich ist.
- **IP verbergen:** `iceTransportPolicy: 'relay'` – nur Relay-Kandidaten. Ohne TURN entsteht bewusst keine
  Verbindung (statt stillschweigend die IP preiszugeben).
- Verbindungsabbruch: Zustand „disconnected“ wird bis zu 15 s zur Selbstheilung abgewartet; danach bzw. bei
  „failed“ neu verbinden per Code-Austausch – der Verlauf bleibt im Tab erhalten. Mobil kann ein App-Wechsel
  die Verbindung trennen; der Status im Kopf zeigt das jederzeit an.

## Entwicklung

Voraussetzungen: Node.js ≥ 22 (für `CompressionStream('deflate-raw')` in den Unit-Tests).

```bash
npm ci
npm run dev          # Dev-Server (ohne CSP, Debug-Logs nur hier)
npm run typecheck    # TypeScript strict
npm test             # Vitest-Unit-Tests
npm run test:e2e     # Playwright (baut dist/ und die Einzeldatei, startet vite preview)
npm run check        # typecheck + test + build + build:single
```

Für Playwright ggf. einmalig `npx playwright install chromium`. Chromium wird mit
`--disable-features=WebRtcHideLocalIpsWithMdns` gestartet, damit zwei Kontexte ohne mDNS verbinden.

### Tests

- **Vitest:** Codec-Roundtrip und Limits (Decompression-Bomb, Version, Typ, Struktur, Linklänge < 1000),
  SDP-Minimierung, Sicherheitscode (deterministisch, ändert sich bei anderem Fingerprint/Key, MITM),
  Verschlüsselungsschicht (Roundtrip, Replay, Manipulation, Reflexion, Handshake-Regeln), Protokoll-Validierung,
  Rate-Limit, Datei-Chunking und Transfer (Reihenfolge, Längen, Hash, Magic Bytes, Backpressure, Abbruch),
  QR-Roundtrip (erzeugen → mit jsQR lesen), Einstellungen, Linkerkennung.
- **Playwright:** zwei Browser-Kontexte im Modus „Nur lokales Netzwerk“: kompletter Code-Austausch,
  identischer Sicherheitscode, Nachrichten und Dateien in beide Richtungen (inkl. Bildvorschau und
  Integrität), XSS-/Link-Prüfung, Tipp-Anzeige, Chat beenden, keine Requests an fremde Origins, keine
  CSP-Verstöße; Fehlerfälle (andere Einladung, neu geladen, bereits verwendet), BroadcastChannel-Übergabe,
  `bye` bei `pagehide`, Reconnect mit erhaltenem Verlauf, ICE-Fehlermeldung, Einzeldatei über `file://`.

### Manuelle Testmatrix

Vor einem Release auf echten Geräten prüfen (✓ = verbunden, Sicherheitscode identisch, Text + Datei in
beide Richtungen, Verbindungsart plausibel):

| Szenario | Chrome ↔ Chrome | Chrome ↔ Firefox | Firefox ↔ Safari | Desktop ↔ iPhone (Safari) | Android Chrome ↔ iPhone |
| --- | --- | --- | --- | --- | --- |
| Gleiches WLAN | | | | | |
| Gleiches WLAN, „Nur lokales Netzwerk“ | | | | | |
| WLAN ↔ Mobilfunk | | | | | |
| Mobilfunk ↔ Mobilfunk (CGNAT) | | | | | |
| Mit TURN + „IP verbergen“ | | | | | |
| QR-Code mit Handykamera öffnen | | | | | |
| Antwort-Link im selben Browser (Übergabe) | | | | | |
| App-Wechsel am Handy (Status/Reconnect) | | | | | |
| Einzeldatei lokal (`file://`) | | | | | |

Hinweise: iOS erst ab 16.4 (`CompressionStream`). Bei Mobilfunk ↔ Mobilfunk ist ohne TURN ein Scheitern
normal – dann muss die verständliche Fehlermeldung mit Lösungswegen erscheinen.

## Abhängigkeiten

Alle Versionen sind exakt gepinnt; `package-lock.json` ist committet.

| Paket | Zweck |
| --- | --- |
| `preact` | UI (escaped Text automatisch) |
| `uqr` | kleiner, abhängigkeitsfreier QR-Generator (MIT) |
| `jsqr` | QR-Scan-Fallback, wenn `BarcodeDetector` fehlt (lazy geladen) |
| `vite`, `@preact/preset-vite` | Build/Dev-Server |
| `@babel/core` | Pflicht-Peer-Dependency von `@preact/preset-vite` (nur Build-Zeit) |
| `typescript`, `@types/node` | Typprüfung (Node-Typen für Build-Skripte und Tests) |
| `vitest`, `@playwright/test` | Tests |
| `vite-plugin-singlefile` | Einzeldatei-Build |

Später geplant (bewusst noch nicht umgesetzt): selbstlöschende Nachrichten, Sprachnachrichten,
Audio-/Videoanruf (Renegotiation über den bestehenden DataChannel), PWA, Gruppenchat.

## Lizenz

MIT
