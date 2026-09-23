import { useState } from 'preact/hooks';
import { t } from '../../i18n/de';
import {
  DEFAULT_STUN_URLS,
  isValidStunUrl,
  isValidTurnUrl,
  type NetworkMode,
  type Settings as SettingsType,
} from '../../settings/settings';
import { Page } from '../components/Layout';
import { useAppState, useController, useFlag } from '../hooks';

export function Settings() {
  const c = useController();
  const { settings } = useAppState();
  const [mode, setMode] = useState<NetworkMode>(settings.networkMode);
  const [stun, setStun] = useState(settings.stunUrls.join('\n'));
  const [turnUrl, setTurnUrl] = useState(settings.turnUrl);
  const [turnUser, setTurnUser] = useState(settings.turnUsername);
  const [turnPassword, setTurnPassword] = useState(settings.turnPassword);
  const [remember, setRemember] = useState(settings.rememberTurnPassword);
  const [hideIp, setHideIp] = useState(settings.hideIp);
  const [sound, setSound] = useState(settings.sound);
  const [saved, flagSaved] = useFlag();

  const stunList = stun
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const stunInvalid = stunList.some((u) => !isValidStunUrl(u));
  const turnInvalid = turnUrl.trim() !== '' && !isValidTurnUrl(turnUrl.trim());
  const turnConfigured = turnUrl.trim() !== '' && !turnInvalid;
  const hideIpPossible = mode === 'internet' && turnConfigured;

  const save = () => {
    if (stunInvalid || turnInvalid) return;
    const next: SettingsType = {
      networkMode: mode,
      stunUrls: stunList,
      turnUrl: turnUrl.trim(),
      turnUsername: turnUser,
      turnPassword,
      rememberTurnPassword: remember,
      hideIp: hideIp && hideIpPossible,
      sound,
    };
    c.updateSettings(next);
    flagSaved();
  };

  return (
    <Page title={t.settings.title} onBack={() => c.back()}>
      <form
        class="stack settings"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset>
          <legend>{t.settings.network}</legend>
          <label class="radio">
            <input
              type="radio"
              name="mode"
              value="internet"
              checked={mode === 'internet'}
              data-testid="mode-internet"
              onChange={() => setMode('internet')}
            />
            <span>
              <strong>{t.settings.modeInternet}</strong>
              <span class="hint small">{t.settings.modeInternetHint}</span>
            </span>
          </label>
          <label class="radio">
            <input
              type="radio"
              name="mode"
              value="lan"
              checked={mode === 'lan'}
              data-testid="mode-lan"
              onChange={() => setMode('lan')}
            />
            <span>
              <strong>{t.settings.modeLan}</strong>
              <span class="hint small">{t.settings.modeLanHint}</span>
            </span>
          </label>

          {mode === 'internet' && (
            <div class="stack">
              <label class="field-label" for="stun-urls">
                {t.settings.stunLabel}
              </label>
              <textarea
                id="stun-urls"
                class="code-field"
                rows={3}
                value={stun}
                spellcheck={false}
                autoCapitalize="off"
                aria-invalid={stunInvalid || undefined}
                onInput={(e) => setStun((e.currentTarget as HTMLTextAreaElement).value)}
              />
              {stunInvalid && <p class="error small">{t.settings.stunInvalid}</p>}
              <button type="button" class="btn small" onClick={() => setStun(DEFAULT_STUN_URLS.join('\n'))}>
                {t.settings.stunReset}
              </button>
            </div>
          )}
        </fieldset>

        {mode === 'internet' && (
          <fieldset>
            <legend>{t.settings.turnTitle}</legend>
            <p class="hint small">{t.settings.turnHint}</p>
            <label class="field-label" for="turn-url">
              {t.settings.turnUrl}
            </label>
            <input
              id="turn-url"
              type="text"
              inputMode="url"
              autoCapitalize="off"
              spellcheck={false}
              placeholder={t.settings.turnUrlPlaceholder}
              value={turnUrl}
              aria-invalid={turnInvalid || undefined}
              onInput={(e) => setTurnUrl((e.currentTarget as HTMLInputElement).value)}
            />
            {turnInvalid && <p class="error small">{t.settings.turnInvalid}</p>}
            <label class="field-label" for="turn-user">
              {t.settings.turnUser}
            </label>
            <input
              id="turn-user"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              value={turnUser}
              onInput={(e) => setTurnUser((e.currentTarget as HTMLInputElement).value)}
            />
            <label class="field-label" for="turn-password">
              {t.settings.turnPassword}
            </label>
            <input
              id="turn-password"
              type="password"
              autoComplete="off"
              value={turnPassword}
              onInput={(e) => setTurnPassword((e.currentTarget as HTMLInputElement).value)}
            />
            <label class="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember((e.currentTarget as HTMLInputElement).checked)} />
              <span>
                {t.settings.rememberPassword}
                <span class="hint small">{t.settings.rememberHint}</span>
              </span>
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={hideIp && hideIpPossible}
                disabled={!hideIpPossible}
                onChange={(e) => setHideIp((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>
                {t.settings.hideIp}
                <span class="hint small">{hideIpPossible ? t.settings.hideIpHint : t.settings.hideIpNeedsTurn}</span>
              </span>
            </label>
          </fieldset>
        )}

        <fieldset>
          <legend>{t.settings.other}</legend>
          <label class="check">
            <input type="checkbox" checked={sound} onChange={(e) => setSound((e.currentTarget as HTMLInputElement).checked)} />
            <span>{t.settings.sound}</span>
          </label>
        </fieldset>

        <p class="hint small">
          {t.settings.storageNote} {t.settings.appliesNext}
        </p>
        <div class="button-row">
          <button type="submit" class="btn primary" data-testid="settings-save" disabled={stunInvalid || turnInvalid}>
            {saved ? t.settings.saved : t.settings.save}
          </button>
        </div>
      </form>
    </Page>
  );
}
