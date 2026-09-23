import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n/de';
import { Dialog } from './Dialog';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

type JsQr = (data: Uint8ClampedArray, width: number, height: number, opts?: object) => { data: string } | null;

async function createNativeDetector(): Promise<Detector | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: any }).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats: string[] = await BD.getSupportedFormats();
    if (!formats.includes('qr_code')) return null;
    return new BD({ formats: ['qr_code'] }) as Detector;
  } catch {
    return null;
  }
}

/** QR-Scanner: BarcodeDetector, falls vorhanden, sonst jsQR (lazy geladen). */
export function Scanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>(t.scan.starting);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t.scan.unavailable);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        setError(e instanceof DOMException && e.name === 'NotAllowedError' ? t.scan.denied : t.scan.unavailable);
        return;
      }
      if (stopped) return stop();
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStatus(t.scan.hint);

      const native = await createNativeDetector();
      let jsqr: JsQr | null = null;
      if (!native) jsqr = ((await import('jsqr')).default as unknown as JsQr) ?? null;

      const tick = async () => {
        if (stopped) return;
        try {
          let text: string | null = null;
          if (video.readyState >= 2) {
            if (native) {
              const codes = await native.detect(video);
              text = codes[0]?.rawValue ?? null;
            } else if (jsqr && ctx) {
              const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsqr(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
            }
          }
          if (text && !stopped) {
            stop();
            onResult(text);
            return;
          }
        } catch {
          /* Einzelbild fehlgeschlagen – weiter versuchen */
        }
        timer = setTimeout(tick, 200);
      };
      void tick();
    })();

    return stop;
  }, []);

  return (
    <Dialog title={t.scan.title} onClose={onClose} testId="scanner">
      <div class="scanner">
        <video ref={videoRef} class="scanner-video" playsInline muted autoPlay aria-hidden="true" />
        <p class={error ? 'error' : 'hint'} role={error ? 'alert' : 'status'}>
          {error ?? status}
        </p>
      </div>
      <div class="button-row">
        <button type="button" class="btn" onClick={onClose}>
          {t.common.close}
        </button>
      </div>
    </Dialog>
  );
}
