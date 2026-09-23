import type { ComponentChildren } from 'preact';
import { t } from '../../i18n/de';
import { useAutoFocus, useController } from '../hooks';

/** Rahmen für Nicht-Chat-Screens: Kopfzeile mit Titel und optionalem Zurück-Button. */
export function Page({
  title,
  onBack,
  backLabel = t.common.back,
  children,
  wide = false,
}: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  children: ComponentChildren;
  wide?: boolean;
}) {
  const headingRef = useAutoFocus<HTMLHeadingElement>();
  return (
    <div class="page">
      <header class="topbar">
        {onBack ? (
          <button type="button" class="btn ghost back" onClick={onBack}>
            <span aria-hidden="true">←</span> {backLabel}
          </button>
        ) : (
          <span class="brand" aria-hidden="true">
            {t.app.name}
          </span>
        )}
      </header>
      <main class={wide ? 'content wide' : 'content'}>
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}

export function FooterLinks() {
  const c = useController();
  return (
    <footer class="footer-links">
      <button type="button" class="linklike" onClick={() => c.openOverlay('security')}>
        {t.common.howSecure}
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" class="linklike" onClick={() => c.openOverlay('settings')}>
        {t.common.settings}
      </button>
    </footer>
  );
}
