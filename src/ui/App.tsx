import { useEffect } from 'preact/hooks';
import { t } from '../i18n/de';
import { useAppState } from './hooks';
import { Page } from './components/Layout';
import { Chat } from './screens/Chat';
import { Handover } from './screens/Handover';
import { Paste } from './screens/Paste';
import { Security } from './screens/Security';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import { Start } from './screens/Start';

export function App() {
  const state = useAppState();

  useEffect(() => {
    document.title = state.unread > 0 ? t.app.titleUnread(state.unread) : t.app.name;
  }, [state.unread]);

  const screen = state.screen;
  switch (screen.name) {
    case 'start':
      return <Start />;
    case 'paste':
      return <Paste key="paste" reconnect={screen.reconnect} error={screen.error} info={screen.info} />;
    case 'setup':
      return <Setup />;
    case 'handover':
      return <Handover status={screen.status} code={screen.code} />;
    case 'chat':
      return <Chat />;
    case 'settings':
      return <Settings />;
    case 'security':
      return <Security />;
    case 'fatal':
      return (
        <Page title={t.app.name}>
          <p class="error" role="alert">
            {screen.message}
          </p>
        </Page>
      );
  }
}
