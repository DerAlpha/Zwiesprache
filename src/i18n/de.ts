// Alle UI-Texte zentral an einer Stelle (Deutsch).

export const de = {
  app: {
    name: 'Zwiesprache',
    tagline: 'Privat chatten – direkt von Gerät zu Gerät, ohne Server und ohne Konto.',
    titleUnread: (n: number) => `(${n}) Zwiesprache`,
  },

  common: {
    back: 'Zurück',
    close: 'Schließen',
    cancel: 'Abbrechen',
    copyLink: 'Link kopieren',
    copyCode: 'Nur Code kopieren',
    copied: 'Kopiert ✓',
    copyFailed: 'Kopieren nicht möglich – bitte manuell markieren und kopieren.',
    share: 'Teilen …',
    showQr: 'QR-Code zeigen',
    hideQr: 'QR-Code ausblenden',
    scanQr: 'QR scannen',
    pasteFromClipboard: 'Aus Zwischenablage einfügen',
    clipboardFailed: 'Kein Zugriff auf die Zwischenablage – bitte manuell einfügen (lange tippen bzw. Strg+V).',
    settings: 'Einstellungen',
    howSecure: 'Wie sicher ist das?',
    working: 'Einen Moment …',
  },

  start: {
    newChat: 'Neuen Chat starten',
    paste: 'Link/Code einfügen',
    scan: 'QR scannen',
    howTitle: 'So funktioniert’s',
    how: [
      'Du startest einen Chat und schickst den Einladungslink an dein Gegenüber – per Messenger, Mail oder QR-Code.',
      'Dein Gegenüber öffnet den Link und schickt dir einen Antwort-Link zurück.',
      'Du fügst die Antwort ein – fertig. Ab dann geht alles direkt und verschlüsselt zwischen euren Geräten.',
    ],
    noServer: 'Keine Anmeldung. Kein Server speichert eure Nachrichten. Schließt du den Tab, ist alles weg.',
    localFile: 'Lokal geöffnete Datei: Links funktionieren nur, wenn dein Gegenüber dieselbe Datei öffnet – schickt euch dann einfach den Code.',
  },

  steps: {
    label: 'Fortschritt',
    host: ['Einladung teilen', 'Antwort einfügen', 'Verbunden'],
    guest: ['Einladung geöffnet', 'Antwort zurückschicken', 'Verbunden'],
    current: (n: number, total: number) => `Schritt ${n} von ${total}`,
  },

  host: {
    title: 'Neuer Chat',
    reconnectTitle: 'Neu verbinden',
    creating: 'Einladung wird erstellt …',
    shareTitle: '1. Einladung teilen',
    shareHint: 'Schicke diesen Link an dein Gegenüber – z. B. per Messenger oder lass den QR-Code scannen.',
    linkLabel: 'Einladungslink',
    keepOpen: 'Lass diesen Tab offen, bis ihr verbunden seid. Lädst du ihn neu, wird die Einladung ungültig.',
    answerTitle: '2. Antwort einfügen',
    answerHint: 'Dein Gegenüber schickt dir einen Antwort-Link. Füge ihn hier ein. Öffnest du ihn in diesem Browser, wird er automatisch übernommen.',
    answerLabel: 'Antwort-Link oder -Code',
    answerPlaceholder: 'https://…#a=… oder Code',
    connect: 'Verbinden',
    connecting: 'Verbinde …',
    expiredTitle: 'Noch keine Antwort?',
    expired:
      'Du wartest seit über 10 Minuten. Die Einladung bleibt gültig, solange dieser Tab offen ist – bei Problemen erzeugst du einfach eine neue.',
    newCode: 'Neuen Code erzeugen',
  },

  guest: {
    title: 'Einladung annehmen',
    creating: 'Antwort wird erstellt …',
    answerTitle: '2. Antwort zurückschicken',
    answerHint:
      'Schicke diesen Antwort-Link an die Person zurück, die dich eingeladen hat. Sobald sie ihn einfügt, verbindet ihr euch automatisch.',
    linkLabel: 'Antwort-Link',
    waiting: 'Warte auf Verbindung …',
    keepOpen: 'Lass diesen Tab offen, bis ihr verbunden seid.',
  },

  share: {
    ipHint: 'Hinweis: Der Link enthält deine IP-Adresse. Sichtbar für dein Gegenüber und jeden, der den Link sieht.',
    ipHintHidden: 'IP verbergen ist aktiv: Der Link enthält nur die Adresse deines TURN-Servers.',
    shareTitleInvite: 'Einladung zu Zwiesprache',
    shareTitleAnswer: 'Antwort für Zwiesprache',
    localFile: 'Diese App läuft als lokale Datei. Der Link funktioniert nur auf Geräten mit derselben Datei – schicke sonst den Code.',
  },

  paste: {
    title: 'Link oder Code einfügen',
    hint: 'Füge einen Einladungslink oder einen Antwort-Link ein. Die App erkennt automatisch, was es ist.',
    label: 'Link oder Code',
    placeholder: 'https://…#i=… oder Code',
    submit: 'Weiter',
    handedOver: 'Antwort wurde an den wartenden Tab übergeben.',
  },

  handover: {
    title: 'Übergeben',
    done: 'Übergeben – du kannst diesen Tab schließen.',
    doneHint: 'Der wartende Tab hat die Antwort übernommen und verbindet sich jetzt.',
    searching: 'Suche den wartenden Tab …',
    notFoundTitle: 'Kein wartender Tab gefunden',
    notFound:
      'In diesem Browser wartet kein Tab auf diese Antwort. Kopiere den Code und füge ihn in dem Tab bzw. auf dem Gerät ein, auf dem du die Einladung erstellt hast.',
  },

  errors: {
    generic: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
    codeEmpty: 'Bitte einen Link oder Code einfügen.',
    codeTooLong: 'Der Code ist zu lang – vermutlich ist er beschädigt oder unvollständig.',
    codeFormat: 'Das sieht nicht nach einem gültigen Zwiesprache-Link oder -Code aus.',
    codeVersion: 'Dieser Code stammt aus einer anderen App-Version.',
    codeDamaged: 'Der Code ist beschädigt oder unvollständig. Bitte komplett kopieren.',
    wrongTypeExpectedAnswer: 'Das ist eine Einladung, keine Antwort. Hier gehört der Antwort-Link deines Gegenübers hin.',
    otherInvitation: 'Diese Antwort gehört zu einer anderen Einladung. Bitte die Antwort auf die aktuelle Einladung einfügen.',
    invitationGone: 'Einladung ungültig – Seite wurde neu geladen. Bitte eine neue Einladung erstellen und erneut austauschen.',
    alreadyUsed: 'Diese Einladung wurde bereits verwendet. Eine Einladung gilt für genau eine Verbindung.',
    rtcUnsupported: 'Dieser Browser unterstützt die nötigen Funktionen (WebRTC, Web Crypto, Kompression) nicht.',
    insecureContext: 'Die App muss über HTTPS (oder als lokale Datei) geöffnet werden.',
    setupFailed: 'Die Verbindung konnte nicht vorbereitet werden.',
    iceFailedTitle: 'Keine direkte Verbindung möglich',
    iceFailed: 'Eure Geräte konnten sich nicht erreichen. Das passiert oft im Mobilfunknetz oder hinter strengen Firewalls. Das hilft:',
    iceFailedTips: [
      'Beide Geräte ins selbe WLAN bringen.',
      'Ein Gerät als Hotspot nutzen und das andere damit verbinden.',
      'In den Einstellungen einen TURN-Server eintragen.',
    ],
    guestSlowTitle: 'Noch keine Verbindung?',
    guestSlow:
      'Hat dein Gegenüber den Antwort-Link schon eingefügt? Falls ja, konnten sich eure Geräte vermutlich nicht erreichen – oft im Mobilfunknetz oder hinter strengen Firewalls. Das hilft:',
    noCandidates: 'Es wurden keine Verbindungswege gefunden. Prüfe die Einstellungen (TURN-Server für „IP verbergen“).',
    handshakeFailed: 'Der sichere Schlüsselaustausch ist fehlgeschlagen. Bitte neu verbinden.',
    tryAgain: 'Neu versuchen',
    openSettings: 'Einstellungen öffnen',
  },

  status: {
    securing: 'Schlüsselaustausch …',
    connected: 'Verbunden',
    reconnecting: 'Verbindung unterbrochen – versuche wiederherzustellen …',
    lost: 'Verbindung verloren',
    ended: 'Chat beendet',
    typeLan: 'Direkt (lokal)',
    typeInternet: 'Direkt (Internet)',
    typeRelay: 'Über Relay',
    typeUnknown: 'Verbindungsart wird ermittelt …',
  },

  chat: {
    title: 'Chat',
    placeholder: 'Nachricht schreiben …',
    send: 'Senden',
    attach: 'Datei anhängen',
    typing: 'schreibt …',
    sending: 'wird gesendet',
    sent: 'gesendet',
    delivered: 'zugestellt',
    failed: 'nicht gesendet',
    you: 'Du',
    peer: 'Gegenüber',
    messagesLabel: 'Nachrichten',
    endChat: 'Chat beenden',
    endConfirm: 'Chat wirklich beenden? Alle Nachrichten und Dateien in diesem Tab werden verworfen.',
    endYes: 'Ja, beenden',
    menu: 'Menü',
    peerEnded: 'Dein Gegenüber hat den Chat beendet.',
    lostTitle: 'Verbindung verloren',
    lostHint: 'Der Verlauf bleibt in diesem Tab erhalten. Tauscht neue Codes aus, um weiterzuschreiben.',
    reconnectHost: 'Neue Einladung erstellen',
    reconnectGuest: 'Einladung einfügen',
    backToStart: 'Zurück zum Start',
    reconnected: 'Wieder verbunden.',
    connectedNote: 'Verbunden. Vergleicht den Sicherheitscode, um sicherzugehen, dass niemand dazwischensitzt.',
    tooLong: (max: number) => `Die Nachricht ist zu lang (max. ${max.toLocaleString('de-DE')} Zeichen).`,
  },

  safety: {
    badgeVerified: 'Verifiziert',
    badgeUnverified: 'Nicht verifiziert',
    title: 'Sicherheitscode',
    explain:
      'Vergleicht den Code am Telefon oder persönlich. Stimmt er auf beiden Geräten überein, sitzt niemand zwischen euch.',
    verify: 'Verifiziert',
    mismatch: 'Stimmt nicht überein',
    later: 'Später',
    mismatchTitle: 'Achtung: Code stimmt nicht',
    mismatchText:
      'Wenn die Codes nicht übereinstimmen, könnte jemand die Verbindung abfangen. Beendet den Chat und tauscht neue Links über einen anderen Weg aus.',
    hint: 'Noch nicht verifiziert – Sicherheitscode vergleichen',
    unverify: 'Verifizierung zurücknehmen',
    verifiedNote: 'Ihr habt den Code verglichen. Diese Verbindung ist verifiziert.',
    carriedOver: 'Gleiche Geräte wie bei der verifizierten Verbindung – Verifizierung bleibt bestehen.',
    newCode: 'Neue Verbindung – bitte den Sicherheitscode erneut vergleichen.',
  },

  files: {
    units: ['B', 'KB', 'MB', 'GB'],
    tooLarge: (maxMb: number) => `Die Datei ist zu groß (max. ${maxMb} MB).`,
    preparing: 'Wird vorbereitet …',
    sending: 'Wird gesendet',
    receiving: 'Wird empfangen',
    done: 'Fertig',
    cancelled: 'Abgebrochen',
    failed: 'Fehlgeschlagen',
    integrity: 'Integritätsprüfung fehlgeschlagen – Datei verworfen.',
    download: 'Speichern',
    cancel: 'Abbrechen',
    progress: (pct: number) => `${pct} %`,
    imageAlt: (name: string) => `Bild: ${name}`,
    tooMany: 'Zu viele gleichzeitige Übertragungen – bitte warten.',
  },

  scan: {
    title: 'QR-Code scannen',
    hint: 'Halte die Kamera auf den QR-Code deines Gegenübers.',
    starting: 'Kamera wird gestartet …',
    denied: 'Kein Zugriff auf die Kamera. Erlaube den Zugriff oder füge den Link manuell ein.',
    unavailable: 'Keine Kamera verfügbar.',
  },

  settings: {
    title: 'Einstellungen',
    network: 'Netzwerk',
    modeInternet: 'Internet (mit STUN)',
    modeInternetHint: 'Standard. Ein STUN-Server hilft, die öffentliche Adresse zu ermitteln. Er sieht dabei nur deine IP, keine Inhalte.',
    modeLan: 'Nur lokales Netzwerk',
    modeLanHint: 'Ohne STUN – funktioniert nur, wenn beide Geräte im selben Netzwerk sind.',
    stunLabel: 'STUN-Server (einer pro Zeile)',
    stunReset: 'Standard wiederherstellen',
    stunInvalid: 'Ungültige STUN-Adresse (erwartet z. B. stun:stun.example.org:3478).',
    turnTitle: 'Eigener TURN-Server (optional)',
    turnHint: 'Ein TURN-Server leitet die (weiterhin verschlüsselten) Daten weiter, wenn keine direkte Verbindung möglich ist.',
    turnUrl: 'TURN-URL',
    turnUrlPlaceholder: 'turn:turn.example.org:3478',
    turnInvalid: 'Ungültige TURN-Adresse (erwartet z. B. turn:turn.example.org:3478 oder turns:…).',
    turnUser: 'Benutzername',
    turnPassword: 'Passwort',
    rememberPassword: 'Passwort auf diesem Gerät merken',
    rememberHint: 'Sonst gilt das Passwort nur, solange dieser Tab offen ist.',
    hideIp: 'IP verbergen (nur über TURN verbinden)',
    hideIpHint: 'Deine IP-Adresse erscheint dann weder im Link noch beim Gegenüber – nur die des TURN-Servers.',
    hideIpNeedsTurn: 'Benötigt einen TURN-Server.',
    hideIpNoTurnWarning: '„IP verbergen“ ist aktiv, aber kein TURN-Server eingetragen – so kann keine Verbindung entstehen.',
    other: 'Sonstiges',
    sound: 'Benachrichtigungston bei neuen Nachrichten',
    save: 'Speichern',
    saved: 'Gespeichert ✓',
    storageNote: 'Einstellungen werden nur lokal in diesem Browser gespeichert.',
    appliesNext: 'Änderungen gelten für die nächste Verbindung.',
  },

  security: {
    title: 'Wie sicher ist das?',
    sections: [
      {
        heading: 'Direkt von Gerät zu Gerät',
        paragraphs: [
          'Zwiesprache besteht nur aus statischen Dateien. Es gibt keinen Server, der Nachrichten weiterleitet oder speichert, kein Konto und keine Analyse. Nachrichten und Dateien gehen per WebRTC direkt zwischen euren Browsern hin und her.',
          'Den Verbindungsaufbau erledigt ihr selbst, indem ihr Einladung und Antwort austauscht. Die Codes stehen im Teil der Adresse nach dem #. Dieser Teil wird nie an den Webserver geschickt, und die App entfernt ihn sofort aus der Adresszeile und dem Verlauf.',
          'Einzige Ausnahme: Ein STUN-Server (änderbar, abschaltbar) hilft beim Finden der öffentlichen Adresse. Optional leitet ein TURN-Server die verschlüsselten Daten weiter. Beide sehen IP-Adressen, aber keine Inhalte.',
        ],
      },
      {
        heading: 'Zwei Verschlüsselungsschichten',
        paragraphs: [
          'Erste Schicht: WebRTC verschlüsselt den Datenkanal immer mit DTLS. Das erzwingt der Browser.',
          'Zweite Schicht: Direkt nach dem Verbindungsaufbau erzeugen beide Geräte neue Schlüssel (ECDH P-256) und leiten daraus für jede Richtung einen eigenen AES-256-GCM-Schlüssel ab. Jede Nachricht, jede Datei, jede Tipp-Anzeige und jede Lesebestätigung läuft zusätzlich durch diese Schicht. Wiederholte oder veränderte Nachrichten werden verworfen. Verwendet wird ausschließlich die Web-Crypto-Schnittstelle des Browsers – keine selbst erfundene Kryptografie.',
        ],
      },
      {
        heading: 'Der Sicherheitscode',
        paragraphs: [
          'Wer die Einladung unterwegs abfängt und austauscht, könnte sich unbemerkt dazwischenschalten („Man in the Middle“). Dagegen hilft der 20-stellige Sicherheitscode. Er wird aus den Zertifikats-Fingerprints beider Browser und beiden neuen Schlüsseln berechnet.',
          'Der Code ist nur dann auf beiden Geräten gleich, wenn niemand dazwischensitzt. Vergleicht ihn deshalb über einen anderen Weg – am Telefon oder persönlich – und tippt dann auf „Verifiziert“.',
        ],
      },
      {
        heading: 'Deine IP-Adresse',
        paragraphs: [
          'Damit sich eure Geräte finden, stehen im Einladungs- und Antwort-Code eure IP-Adressen. Sie sind für dein Gegenüber sichtbar – und für jeden, der den Link oder Code sieht, etwa den Messenger, über den du ihn schickst.',
          'Wenn du das nicht möchtest, trage in den Einstellungen einen eigenen TURN-Server ein und aktiviere „IP verbergen“. Dann steht nur die Adresse des TURN-Servers im Code.',
        ],
      },
      {
        heading: 'Was gespeichert wird',
        paragraphs: [
          'Nachrichten und Dateien existieren nur im Arbeitsspeicher dieses Tabs. Schließt du ihn oder beendest den Chat, sind sie weg. Nur deine Einstellungen landen im lokalen Speicher des Browsers – das TURN-Passwort nur, wenn du „merken“ aktivierst.',
        ],
      },
      {
        heading: 'Grenzen – ehrlich gesagt',
        paragraphs: [
          'Keine App schützt vor Screenshots, Fotos vom Bildschirm oder davor, dass dein Gegenüber Inhalte weitergibt.',
          'Ist ein Gerät kompromittiert (Schadsoftware, bösartige Browser-Erweiterungen), kann es alles mitlesen.',
          'Du vertraust dem Webspace, von dem du die App lädst: Wer ihn manipuliert, könnte veränderten Code ausliefern. Wer sichergehen will, nutzt die Einzeldatei-Version (zwiesprache.html) und prüft ihre SHA-256-Prüfsumme gegen die veröffentlichte.',
          'Dateien werden ungeprüft übertragen. Bilder zeigt die App nur in sicheren Formaten an; alles andere wird nur gespeichert, nie in der App geöffnet. Öffne gespeicherte Dateien nur, wenn du deinem Gegenüber vertraust.',
          'Metadaten wie „wann und wie lange wart ihr verbunden“ und eure IP-Adressen sind für Netzbetreiber sowie STUN/TURN-Server sichtbar.',
        ],
      },
    ],
  },
} as const;

export type Strings = typeof de;
export const t = de;
