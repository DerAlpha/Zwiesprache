import { useMemo } from 'preact/hooks';
import { qrMatrix } from '../../signaling/qr';

/** QR-Code als SVG (immer dunkel auf hell, damit jede Kamera ihn liest). */
export function QrCode({ text, label }: { text: string; label: string }) {
  const qr = useMemo(() => qrMatrix(text), [text]);
  return (
    <svg
      class="qr"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      shape-rendering="crispEdges"
      data-testid="qr-code"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}
