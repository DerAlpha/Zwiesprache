import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { downloadBlob, type ChatItem, type ChatState } from '../../chat/controller';
import { t } from '../../i18n/de';
import { MAX_TEXT_LENGTH } from '../../protocol/messages';
import { Dialog } from '../components/Dialog';
import { Linkified } from '../components/Linkified';
import { formatBytes, formatTime } from '../format';
import { isCoarsePointer, useAppState, useController } from '../hooks';

function statusText(chat: ChatState): string {
  switch (chat.status) {
    case 'connected':
      return t.status.connected;
    case 'reconnecting':
      return t.status.reconnecting;
    case 'lost':
      return t.status.lost;
    case 'ended':
      return t.status.ended;
  }
}

function connectionTypeText(chat: ChatState): string | null {
  if (chat.status !== 'connected') return null;
  switch (chat.connectionType) {
    case 'lan':
      return t.status.typeLan;
    case 'internet':
      return t.status.typeInternet;
    case 'relay':
      return t.status.typeRelay;
    default:
      return t.status.typeUnknown;
  }
}

function SafetyDialog({ chat, onClose }: { chat: ChatState; onClose: () => void }) {
  const c = useController();
  const [mismatch, setMismatch] = useState(false);
  const groups = (chat.safetyCode ?? '').split(' ');
  return (
    <Dialog title={mismatch ? t.safety.mismatchTitle : t.safety.title} onClose={onClose} testId="safety-dialog">
      {mismatch ? (
        <>
          <p>{t.safety.mismatchText}</p>
          <div class="button-row">
            <button type="button" class="btn danger" onClick={() => c.endChat()}>
              {t.chat.endChat}
            </button>
            <button type="button" class="btn" onClick={onClose}>
              {t.common.close}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{t.safety.explain}</p>
          <p class="safety-code" data-testid="safety-code" aria-label={groups.join(', ')}>
            {groups.map((g, i) => (
              <span key={i} class="safety-group">
                {g}
                {i < groups.length - 1 ? ' ' : ''}
              </span>
            ))}
          </p>
          {chat.verified && <p class="success">{t.safety.verifiedNote}</p>}
          <div class="button-row">
            {!chat.verified ? (
              <button
                type="button"
                class="btn primary"
                data-testid="safety-verify"
                onClick={() => {
                  c.setVerified(true);
                  onClose();
                }}
              >
                {t.safety.verify}
              </button>
            ) : (
              <button type="button" class="btn" onClick={() => c.setVerified(false)}>
                {t.safety.unverify}
              </button>
            )}
            {!chat.verified && (
              <button type="button" class="btn danger-outline" onClick={() => setMismatch(true)}>
                {t.safety.mismatch}
              </button>
            )}
            <button type="button" class="btn ghost" onClick={onClose}>
              {chat.verified ? t.common.close : t.safety.later}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function FileBubble({ item }: { item: ChatItem }) {
  const c = useController();
  const f = item.file!;
  const pct = f.size === 0 ? 100 : Math.floor((f.transferred / f.size) * 100);
  const active = f.state === 'transferring' || f.state === 'preparing';
  const stateText =
    f.state === 'preparing'
      ? t.files.preparing
      : f.state === 'transferring'
        ? `${item.direction === 'out' ? t.files.sending : t.files.receiving} · ${t.files.progress(pct)}`
        : f.state === 'verifying'
          ? t.common.working
          : f.state === 'done'
            ? t.files.done
            : f.state === 'cancelled'
              ? t.files.cancelled
              : t.files.failed;
  return (
    <div class="file" data-testid="file-item" data-state={f.state}>
      {f.previewUrl && <img class="file-preview" src={f.previewUrl} alt={t.files.imageAlt(f.name)} />}
      <div class="file-row">
        <span class="file-icon" aria-hidden="true">
          📄
        </span>
        <div class="file-meta">
          <span class="file-name" data-testid="file-name">
            {f.name}
          </span>
          <span class="file-sub">
            {formatBytes(f.size)} · <span data-testid="file-state">{stateText}</span>
          </span>
        </div>
      </div>
      {active && <progress max={100} value={pct} aria-label={f.name} />}
      {f.error && <p class="error small">{f.error}</p>}
      <div class="file-actions">
        {active && (
          <button type="button" class="btn small" onClick={() => c.cancelFile(item.id)}>
            {t.files.cancel}
          </button>
        )}
        {f.state === 'done' && f.blob && item.direction === 'in' && (
          <button type="button" class="btn small" data-testid="file-download" onClick={() => downloadBlob(f.blob!, f.name)}>
            {t.files.download}
          </button>
        )}
      </div>
    </div>
  );
}

function Bubble({ item }: { item: ChatItem }) {
  if (item.kind === 'system') {
    return (
      <li class="system" data-testid="system-message">
        {item.body}
      </li>
    );
  }
  const statusLabel =
    item.status === 'sending'
      ? t.chat.sending
      : item.status === 'sent'
        ? t.chat.sent
        : item.status === 'delivered'
          ? t.chat.delivered
          : item.status === 'failed'
            ? t.chat.failed
            : null;
  return (
    <li class={`msg ${item.direction}`} data-testid={item.direction === 'in' ? 'msg-in' : 'msg-out'}>
      <div class="bubble">
        <span class="visually-hidden">{item.direction === 'in' ? t.chat.peer : t.chat.you}: </span>
        {item.kind === 'text' ? (
          <p class="text" data-testid="msg-text">
            <Linkified text={item.body} />
          </p>
        ) : (
          <FileBubble item={item} />
        )}
        <span class="meta">
          <time dateTime={new Date(item.ts).toISOString()}>{formatTime(item.ts)}</time>
          {item.direction === 'out' && statusLabel && (
            <span class={`tick ${item.status}`} data-testid="msg-status" data-status={item.status} title={statusLabel}>
              <span aria-hidden="true">{item.status === 'delivered' ? '✓✓' : item.status === 'failed' ? '!' : '✓'}</span>
              <span class="visually-hidden">{statusLabel}</span>
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

function Composer({ enabled }: { enabled: boolean }) {
  const c = useController();
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tooLong = text.length > MAX_TEXT_LENGTH;

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    // Höhe über CSSOM setzen (CSP-konform, kein style-Attribut).
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [text]);

  const send = async () => {
    if (!enabled || tooLong || text.trim().length === 0) return;
    const body = text;
    setText('');
    const ok = await c.sendText(body);
    if (!ok) setText(body);
    taRef.current?.focus();
  };

  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {fileError && (
        <p class="error small composer-error" role="alert">
          {fileError}
        </p>
      )}
      {tooLong && (
        <p class="error small composer-error" role="alert">
          {t.chat.tooLong(MAX_TEXT_LENGTH)}
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        class="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="file-input"
        onChange={async (e) => {
          const input = e.currentTarget as HTMLInputElement;
          const files = Array.from(input.files ?? []);
          input.value = '';
          setFileError(null);
          for (const file of files) {
            const err = await c.sendFile(file);
            if (err) setFileError(err);
          }
        }}
      />
      <button
        type="button"
        class="btn icon"
        aria-label={t.chat.attach}
        title={t.chat.attach}
        disabled={!enabled}
        onClick={() => fileRef.current?.click()}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M16.5 6.5l-8 8a2.5 2.5 0 0 0 3.5 3.5l8.5-8.5a4.5 4.5 0 0 0-6.4-6.4L5.5 11.7a6.5 6.5 0 0 0 9.2 9.2l6.8-6.8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <label class="visually-hidden" for="composer-input">
        {t.chat.placeholder}
      </label>
      <textarea
        ref={taRef}
        id="composer-input"
        class="composer-input"
        rows={1}
        placeholder={t.chat.placeholder}
        value={text}
        disabled={!enabled}
        maxLength={MAX_TEXT_LENGTH + 1000}
        data-testid="message-input"
        aria-invalid={tooLong ? true : undefined}
        onInput={(e) => {
          const value = (e.currentTarget as HTMLTextAreaElement).value;
          setText(value);
          c.notifyTyping(value.length > 0);
        }}
        onKeyDown={(e) => {
          // Desktop: Enter sendet, Shift+Enter = Zeilenumbruch. Touch-Geräte: Enter = Zeilenumbruch.
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isCoarsePointer()) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button
        type="submit"
        class="btn primary icon"
        aria-label={t.chat.send}
        title={t.chat.send}
        disabled={!enabled || tooLong || text.trim().length === 0}
        data-testid="send-button"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M3.4 20.4l17.5-7.5a1 1 0 0 0 0-1.8L3.4 3.6a1 1 0 0 0-1.4 1.1L4 11l9 1-9 1-2 6.3a1 1 0 0 0 1.4 1.1z" fill="currentColor" />
        </svg>
      </button>
    </form>
  );
}

export function Chat() {
  const c = useController();
  const { chat } = useAppState();
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  const itemCount = chat?.items.length ?? 0;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [itemCount, chat?.peerTyping]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);

  if (!chat) return null;
  const typeText = connectionTypeText(chat);
  const canSend = chat.status === 'connected';

  return (
    <div class="chat">
      <header class="chat-header">
        <div class="chat-title">
          <h1 class="chat-name">{t.app.name}</h1>
          <p class={`chat-status ${chat.status}`} data-testid="chat-status" data-status={chat.status} role="status">
            <span class="dot" aria-hidden="true" />
            {statusText(chat)}
            {typeText && (
              <span class="conn-type" data-testid="connection-type">
                {' · '}
                {typeText}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          class={chat.verified ? 'badge verified' : 'badge unverified'}
          data-testid="safety-badge"
          data-verified={chat.verified}
          onClick={() => setSafetyOpen(true)}
        >
          <span aria-hidden="true">{chat.verified ? '🛡️' : '⚠︎'}</span>{' '}
          {chat.verified ? t.safety.badgeVerified : t.safety.badgeUnverified}
        </button>
        <div class="menu-wrap">
          <button
            type="button"
            class="btn ghost icon"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label={t.chat.menu}
            data-testid="chat-menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden="true">⋮</span>
          </button>
          {menuOpen && (
            <ul class="menu" role="menu">
              <li role="none">
                <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), setSafetyOpen(true))}>
                  {t.safety.title}
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), c.openOverlay('settings'))}>
                  {t.common.settings}
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), c.openOverlay('security'))}>
                  {t.common.howSecure}
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  class="danger-text"
                  data-testid="end-chat"
                  onClick={() => (setMenuOpen(false), setConfirmEnd(true))}
                >
                  {t.chat.endChat}
                </button>
              </li>
            </ul>
          )}
        </div>
      </header>

      {!chat.verified && chat.status === 'connected' && (
        <button type="button" class="verify-hint" onClick={() => setSafetyOpen(true)}>
          {t.safety.hint}
        </button>
      )}

      {(chat.status === 'lost' || chat.status === 'ended') && (
        <div class="banner" role="alert" data-testid="chat-banner">
          <p>
            <strong>{chat.status === 'ended' ? t.chat.peerEnded : t.chat.lostTitle}</strong>
          </p>
          {chat.status === 'lost' && <p class="small">{t.chat.lostHint}</p>}
          <div class="button-row">
            {chat.status === 'lost' && (
              <>
                <button type="button" class="btn primary" onClick={() => void c.startHost(true)}>
                  {t.chat.reconnectHost}
                </button>
                <button type="button" class="btn" onClick={() => c.openPaste(true)}>
                  {t.chat.reconnectGuest}
                </button>
              </>
            )}
            <button type="button" class="btn ghost" onClick={() => c.endChat()}>
              {t.chat.backToStart}
            </button>
          </div>
        </div>
      )}

      <ol
        ref={listRef}
        class="messages"
        role="log"
        aria-live="polite"
        aria-label={t.chat.messagesLabel}
        data-testid="messages"
        onScroll={(e) => {
          const el = e.currentTarget as HTMLOListElement;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {chat.items.map((item) => (
          <Bubble key={item.id} item={item} />
        ))}
      </ol>
      <p class="typing" aria-live="off" data-testid="typing">
        {chat.peerTyping ? `${t.chat.peer} ${t.chat.typing}` : ' '}
      </p>

      <Composer enabled={canSend} />

      {safetyOpen && <SafetyDialog chat={chat} onClose={() => setSafetyOpen(false)} />}
      {confirmEnd && (
        <Dialog title={t.chat.endChat} onClose={() => setConfirmEnd(false)}>
          <p>{t.chat.endConfirm}</p>
          <div class="button-row">
            <button type="button" class="btn danger" data-testid="end-confirm" onClick={() => c.endChat()}>
              {t.chat.endYes}
            </button>
            <button type="button" class="btn" onClick={() => setConfirmEnd(false)}>
              {t.common.cancel}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
