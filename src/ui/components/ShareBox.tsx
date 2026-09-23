import { useState } from 'preact/hooks';
import { t } from '../../i18n/de';
import { linksAreShareable } from '../../signaling/links';
import { canShare, copyText, shareLink } from '../clipboard';
import { useFlag } from '../hooks';
import { QrCode } from './QrCode';

/** Link anzeigen und teilen: Kopieren, Web Share, QR-Code. */
export function ShareBox({
  link,
  code,
  kind,
  hideIp,
  testId,
}: {
  link: string;
  code: string;
  kind: 'offer' | 'answer';
  hideIp: boolean;
  testId: string;
}) {
  const [copied, flagCopied] = useFlag();
  const [codeCopied, flagCodeCopied] = useFlag();
  const [copyError, setCopyError] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const shareable = linksAreShareable();
  const label = kind === 'offer' ? t.host.linkLabel : t.guest.linkLabel;
  // Bei lokal geöffneter Datei ist nur der Code übertragbar – der QR enthält dann den Code.
  const qrText = shareable ? link : code;

  const copy = async (text: string, flag: () => void) => {
    const ok = await copyText(text);
    setCopyError(!ok);
    if (ok) flag();
  };

  return (
    <div class="sharebox">
      <label class="field-label" for={`${testId}-field`}>
        {label}
      </label>
      <textarea
        id={`${testId}-field`}
        class="code-field"
        readOnly
        rows={3}
        value={link}
        data-testid={testId}
        onFocus={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
      />
      <div class="button-row">
        <button type="button" class="btn primary" onClick={() => copy(link, flagCopied)}>
          {copied ? t.common.copied : t.common.copyLink}
        </button>
        {canShare() && shareable && (
          <button
            type="button"
            class="btn"
            onClick={() => shareLink(kind === 'offer' ? t.share.shareTitleInvite : t.share.shareTitleAnswer, link)}
          >
            {t.common.share}
          </button>
        )}
        <button type="button" class="btn" aria-expanded={showQr} onClick={() => setShowQr(!showQr)}>
          {showQr ? t.common.hideQr : t.common.showQr}
        </button>
        {!shareable && (
          <button type="button" class="btn" onClick={() => copy(code, flagCodeCopied)}>
            {codeCopied ? t.common.copied : t.common.copyCode}
          </button>
        )}
      </div>
      {copyError && (
        <p class="error" role="alert">
          {t.common.copyFailed}
        </p>
      )}
      {showQr && (
        <div class="qr-wrap">
          <QrCode text={qrText} label={label} />
        </div>
      )}
      <p class="hint small">{hideIp ? t.share.ipHintHidden : t.share.ipHint}</p>
      {!shareable && <p class="hint small">{t.share.localFile}</p>}
    </div>
  );
}
