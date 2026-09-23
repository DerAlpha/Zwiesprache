// Beispiel-SDPs, wie Chrome bzw. Firefox sie für einen reinen Datenkanal erzeugen.

export function fingerprint(seed: number): string {
  const bytes = Array.from({ length: 32 }, (_, i) => ((i * 37 + seed * 11) & 0xff).toString(16).padStart(2, '0').toUpperCase());
  return bytes.join(':');
}

export function chromeOffer(fp = fingerprint(1)): string {
  return [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:3350409123 1 udp 2122260223 192.168.1.23 54321 typ host generation 0 network-id 1 network-cost 10',
    'a=candidate:3350409123 1 udp 2122260223 192.168.1.23 54321 typ host generation 0 network-id 1 network-cost 10',
    'a=candidate:1510613869 1 udp 2122194687 2001:db8::1234 54322 typ host generation 0 network-id 2 network-cost 10',
    'a=candidate:2154773085 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0 network-id 1 network-cost 10',
    'a=candidate:842163049 1 udp 1686052607 203.0.113.7 61234 typ srflx raddr 192.168.1.23 rport 54321 generation 0 network-id 1 network-cost 10',
    'a=ice-ufrag:Xk3d',
    'a=ice-pwd:9f2Pq8LmZr4Tn6Vb1Wc3Yd5E',
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fp}`,
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');
}

export function chromeAnswer(fp = fingerprint(2)): string {
  return chromeOffer(fp).replace('a=setup:actpass', 'a=setup:active').replace('a=ice-ufrag:Xk3d', 'a=ice-ufrag:Ab9Z');
}

export function firefoxOffer(fp = fingerprint(3)): string {
  return [
    'v=0',
    'o=mozilla...THIS_IS_SDPARTA-128.0 5302948291740361234 0 IN IP4 0.0.0.0',
    's=-',
    't=0 0',
    'a=sendrecv',
    `a=fingerprint:sha-256 ${fp}`,
    'a=group:BUNDLE 0',
    'a=ice-options:trickle',
    'a=msid-semantic:WMS *',
    'm=application 51234 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 203.0.113.9',
    'a=candidate:0 1 UDP 2122252543 10.0.0.5 51234 typ host',
    'a=candidate:2 1 TCP 2105524479 10.0.0.5 9 typ host tcptype active',
    'a=candidate:1 1 UDP 1686052863 203.0.113.9 51234 typ srflx raddr 10.0.0.5 rport 51234',
    'a=sendrecv',
    'a=end-of-candidates',
    'a=ice-pwd:0f3ce1a9b2d4e6f8091a2b3c4d5e6f70',
    'a=ice-ufrag:8a7b6c5d',
    'a=mid:0',
    'a=setup:actpass',
    'a=sctp-port:5000',
    'a=max-message-size:1073741823',
    '',
  ].join('\r\n');
}

/** Zufälliger Fingerprint – realistischer für Größenmessungen als ein Muster. */
export function randomFingerprint(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}
