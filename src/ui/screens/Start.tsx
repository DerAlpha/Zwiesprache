import { useState } from 'preact/hooks';
import { t } from '../../i18n/de';
import { linksAreShareable } from '../../signaling/links';
import { FooterLinks } from '../components/Layout';
import { Scanner } from '../components/Scanner';
import { useAutoFocus, useController } from '../hooks';

export function Start() {
  const c = useController();
  const [scanning, setScanning] = useState(false);
  const headingRef = useAutoFocus<HTMLHeadingElement>();

  return (
    <div class="page">
      <main class="content start">
        <div class="hero">
          <div class="logo" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="56" height="56">
              <path d="M8 12a6 6 0 0 1 6-6h14a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-8l-7 6v-6h-.5A4.5 4.5 0 0 1 8 21.5z" fill="currentColor" opacity=".35" />
              <path d="M40 22a6 6 0 0 0-6-6H22a6 6 0 0 0-6 6v8a6 6 0 0 0 6 6h6l7 6v-6h-.5a5.5 5.5 0 0 0 5.5-5.5z" fill="currentColor" />
            </svg>
          </div>
          <h1 ref={headingRef} tabIndex={-1}>
            {t.app.name}
          </h1>
          <p class="lead">{t.app.tagline}</p>
        </div>

        <div class="actions">
          <button type="button" class="btn primary big" data-testid="start-host" onClick={() => void c.startHost(false)}>
            {t.start.newChat}
          </button>
          <button type="button" class="btn big" data-testid="start-paste" onClick={() => c.openPaste(false)}>
            {t.start.paste}
          </button>
          <button type="button" class="btn big" onClick={() => setScanning(true)}>
            {t.start.scan}
          </button>
        </div>

        <section class="card how" aria-labelledby="how-title">
          <h2 id="how-title">{t.start.howTitle}</h2>
          <ol class="how-steps">
            {t.start.how.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p class="hint small">{t.start.noServer}</p>
          {!linksAreShareable() && <p class="hint small">{t.start.localFile}</p>}
        </section>

        <FooterLinks />
      </main>
      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            void c.submitPaste(text, false);
          }}
        />
      )}
    </div>
  );
}
