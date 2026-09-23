import { t } from '../../i18n/de';
import { copyText } from '../clipboard';
import { Page } from '../components/Layout';
import { useController, useFlag } from '../hooks';

export function Handover({ status, code }: { status: 'searching' | 'done' | 'not-found'; code: string }) {
  const c = useController();
  const [copied, flag] = useFlag();
  if (status === 'searching') {
    return (
      <Page title={t.handover.title}>
        <p class="working" role="status">
          <span class="spinner" aria-hidden="true" /> {t.handover.searching}
        </p>
      </Page>
    );
  }
  if (status === 'done') {
    return (
      <Page title={t.handover.title}>
        <div class="card success-card" role="status" data-testid="handover-done">
          <p class="big-text">{t.handover.done}</p>
          <p class="hint">{t.handover.doneHint}</p>
        </div>
      </Page>
    );
  }
  return (
    <Page title={t.handover.notFoundTitle} onBack={() => c.go({ name: 'start' })}>
      <p data-testid="handover-not-found">{t.handover.notFound}</p>
      <label class="field-label" for="handover-code">
        {t.guest.linkLabel}
      </label>
      <textarea id="handover-code" class="code-field" rows={4} readOnly value={code} />
      <div class="button-row">
        <button
          type="button"
          class="btn primary"
          onClick={async () => {
            if (await copyText(code)) flag();
          }}
        >
          {copied ? t.common.copied : t.common.copyCode}
        </button>
      </div>
    </Page>
  );
}
