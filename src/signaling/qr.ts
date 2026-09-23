// QR-Matrix über die abhängigkeitsfreie Bibliothek "uqr". Gerendert wird als SVG-Pfad in der UI.

import { encode } from 'uqr';

export interface QrMatrix {
  size: number;
  /** SVG-Pfad aller dunklen Module (1 Einheit = 1 Modul). */
  path: string;
}

export function qrMatrix(text: string): QrMatrix {
  // ECC "L": maximale Kapazität bei kleinster Version – Bildschirm-zu-Kamera hat kaum Beschädigungen.
  const qr = encode(text, { ecc: 'L', border: 3 });
  let path = '';
  qr.data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      path += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return { size: qr.size, path };
}
