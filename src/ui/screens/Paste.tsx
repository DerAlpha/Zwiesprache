import { useState } from 'preact/hooks';
import { t } from '../../i18n/de';
import { readClipboard } from '../clipboard';
import { Page } from '../components/Layout';
import { Scanner } from '../components/Scanner';
import { useController } from '../hooks';

export function Paste({ reconnect, error, info }: { reconnect: boolean; error: string | null; info: string | null }) {
  const c = useController();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const submit = async (text: string) => {
    setBusy(true);
    setLocalError(null);
    await c.submitPaste(text, reconnect);
    setBusy(false);
  };

  const fromClipboard = async () => {
    const text = await readClipboard();
    if (text === null) {
      setLocalError(t.common.clipboardFailed);
      return;
    }
    setValue(text);
    await submit(text);
  };

  const shownError = localError ?? error;

  return (
    <Page title={t.paste.title} onBack={() => c.go(c.homeScreen())}>
      <p>{t.paste.hint}</p>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value);
        }}
      >
        <label class="field-label" for="paste-input">
          {t.paste.label}
        </label>
        <textarea
          id="paste-input"
          class="code-field"
          rows={4}
          placeholder={t.paste.placeholder}
          value={value}
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          data-testid="paste-input"
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? 'paste-error' : undefined}
          onInput={(e) => setValue((e.currentTarget as HTMLTextAreaElement).value)}
        />
        {shownError && (
          <p id="paste-error" class="error" role="alert">
            {shownError}
          </p>
        )}
        {info && (
          <p class="success" role="status">
            {info}
          </p>
        )}
        <div class="button-row">
          <button type="submit" class="btn primary" disabled={busy} data-testid="paste-submit">
            {busy ? t.common.working : t.paste.submit}
          </button>
          <button type="button" class="btn" onClick={() => void fromClipboard()}>
            {t.common.pasteFromClipboard}
          </button>
          <button type="button" class="btn" onClick={() => setScanning(true)}>
            {t.common.scanQr}
          </button>
        </div>
      </form>
      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            setValue(text);
            void submit(text);
          }}
        />
      )}
    </Page>
  );
}
