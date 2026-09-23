import { useState } from 'preact/hooks';
import { HOST_WAIT_HINT_MS, type SetupState } from '../../chat/controller';
import { t } from '../../i18n/de';
import { hasTurn } from '../../settings/settings';
import { readClipboard } from '../clipboard';
import { Page } from '../components/Layout';
import { Scanner } from '../components/Scanner';
import { ShareBox } from '../components/ShareBox';
import { Steps } from '../components/Steps';
import { useAppState, useController, useNow } from '../hooks';

function IceHelp({ role }: { role: 'host' | 'guest' }) {
  const c = useController();
  return (
    <div class="card warn" role="alert" data-testid="ice-failed">
      <h2>{t.errors.iceFailedTitle}</h2>
      <p>{t.errors.iceFailed}</p>
      <ul>
        {t.errors.iceFailedTips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <div class="button-row">
        {role === 'host' && (
          <button type="button" class="btn primary" onClick={() => void c.startHost()}>
            {t.errors.tryAgain}
          </button>
        )}
        <button type="button" class="btn" onClick={() => c.openOverlay('settings')}>
          {t.errors.openSettings}
        </button>
      </div>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <p class="working" role="status">
      <span class="spinner" aria-hidden="true" /> {label}
    </p>
  );
}

function HostSetup({ setup }: { setup: SetupState }) {
  const c = useController();
  const { settings } = useAppState();
  const now = useNow(1000);
  const [answer, setAnswer] = useState('');
  const [scanning, setScanning] = useState(false);
  const [clipError, setClipError] = useState(false);
  const step = setup.phase === 'creating' || setup.phase === 'waiting' ? (answer.trim() ? 1 : 0) : 2;
  const waitingLong = setup.phase === 'waiting' && now - setup.startedAt > HOST_WAIT_HINT_MS;

  const submit = (text: string) => void c.submitAnswer(text);

  return (
    <>
      <Steps labels={t.steps.host} current={step} />
      {setup.phase === 'creating' && <Spinner label={t.host.creating} />}
      {setup.link && setup.code && (setup.phase === 'waiting' || setup.phase === 'connecting') && (
        <section class="card" aria-labelledby="share-title">
          <h2 id="share-title">{t.host.shareTitle}</h2>
          <p>{t.host.shareHint}</p>
          <ShareBox link={setup.link} code={setup.code} kind="offer" hideIp={settings.hideIp} testId="invite-link" />
          <p class="hint">{t.host.keepOpen}</p>
        </section>
      )}
      {setup.phase === 'waiting' && (
        <section class="card" aria-labelledby="answer-title">
          <h2 id="answer-title">{t.host.answerTitle}</h2>
          <p>{t.host.answerHint}</p>
          <form
            class="stack"
            onSubmit={(e) => {
              e.preventDefault();
              submit(answer);
            }}
          >
            <label class="field-label" for="answer-input">
              {t.host.answerLabel}
            </label>
            <textarea
              id="answer-input"
              class="code-field"
              rows={3}
              placeholder={t.host.answerPlaceholder}
              value={answer}
              autoComplete="off"
              autoCapitalize="off"
              spellcheck={false}
              data-testid="answer-input"
              aria-invalid={setup.error ? true : undefined}
              aria-describedby={setup.error ? 'answer-error' : undefined}
              onInput={(e) => setAnswer((e.currentTarget as HTMLTextAreaElement).value)}
            />
            {setup.error && (
              <p id="answer-error" class="error" role="alert" data-testid="setup-error">
                {setup.error}
              </p>
            )}
            {clipError && <p class="error">{t.common.clipboardFailed}</p>}
            <div class="button-row">
              <button type="submit" class="btn primary" data-testid="answer-submit">
                {t.host.connect}
              </button>
              <button
                type="button"
                class="btn"
                onClick={async () => {
                  const text = await readClipboard();
                  setClipError(text === null);
                  if (text !== null) {
                    setAnswer(text);
                    submit(text);
                  }
                }}
              >
                {t.common.pasteFromClipboard}
              </button>
              <button type="button" class="btn" onClick={() => setScanning(true)}>
                {t.common.scanQr}
              </button>
            </div>
          </form>
        </section>
      )}
      {waitingLong && (
        <div class="card warn" role="status">
          <h2>{t.host.expiredTitle}</h2>
          <p>{t.host.expired}</p>
          <button type="button" class="btn primary" onClick={() => void c.startHost()}>
            {t.host.newCode}
          </button>
        </div>
      )}
      {(setup.phase === 'connecting' || setup.phase === 'securing') && !setup.iceFailed && (
        <Spinner label={setup.phase === 'securing' ? t.status.securing : t.host.connecting} />
      )}
      {setup.iceFailed && <IceHelp role="host" />}
      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            setAnswer(text);
            submit(text);
          }}
        />
      )}
    </>
  );
}

function GuestSetup({ setup }: { setup: SetupState }) {
  const { settings } = useAppState();
  const step = setup.phase === 'creating' ? 0 : setup.phase === 'waiting' ? 1 : 2;
  return (
    <>
      <Steps labels={t.steps.guest} current={step} />
      {setup.phase === 'creating' && <Spinner label={t.guest.creating} />}
      {setup.link && setup.code && setup.phase !== 'error' && setup.phase !== 'securing' && (
        <section class="card" aria-labelledby="guest-answer-title">
          <h2 id="guest-answer-title">{t.guest.answerTitle}</h2>
          <p>{t.guest.answerHint}</p>
          <ShareBox link={setup.link} code={setup.code} kind="answer" hideIp={settings.hideIp} testId="answer-link" />
          <p class="hint">{t.guest.keepOpen}</p>
        </section>
      )}
      {(setup.phase === 'waiting' || setup.phase === 'connecting') && !setup.iceFailed && <Spinner label={t.guest.waiting} />}
      {setup.phase === 'securing' && <Spinner label={t.status.securing} />}
      {setup.iceFailed && <IceHelp role="guest" />}
    </>
  );
}

export function Setup() {
  const c = useController();
  const { setup, settings, chat } = useAppState();
  if (!setup) return null;
  const title = setup.reconnect ? t.host.reconnectTitle : setup.role === 'host' ? t.host.title : t.guest.title;
  const relayWithoutTurn = settings.networkMode === 'internet' && settings.hideIp && !hasTurn(settings);
  return (
    <Page title={title} onBack={() => c.cancelSetup()} backLabel={chat ? t.chat.title : t.common.back}>
      {relayWithoutTurn && <p class="card warn">{t.settings.hideIpNoTurnWarning}</p>}
      {setup.role === 'host' ? <HostSetup setup={setup} /> : <GuestSetup setup={setup} />}
      {setup.phase === 'error' && setup.error && (
        <div class="card warn" role="alert" data-testid="setup-error">
          <p>{setup.error}</p>
          <div class="button-row">
            {setup.role === 'host' && (
              <button type="button" class="btn primary" onClick={() => void c.startHost()}>
                {t.errors.tryAgain}
              </button>
            )}
            <button type="button" class="btn" onClick={() => c.openOverlay('settings')}>
              {t.errors.openSettings}
            </button>
          </div>
        </div>
      )}
    </Page>
  );
}
