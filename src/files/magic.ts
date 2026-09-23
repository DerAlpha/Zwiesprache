// Magic-Byte-Erkennung für die Inline-Vorschau. Nur PNG, JPEG, GIF und WebP werden als Bild
// angezeigt – unabhängig davon, was der Absender als MIME-Typ angibt. SVG/HTML etc. nie.

export type PreviewImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

export function detectPreviewImage(head: Uint8Array): PreviewImageType | null {
  if (startsWith(head, PNG)) return 'image/png';
  if (startsWith(head, JPEG)) return 'image/jpeg';
  if (startsWith(head, GIF87) || startsWith(head, GIF89)) return 'image/gif';
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'image/webp';
  return null;
}
