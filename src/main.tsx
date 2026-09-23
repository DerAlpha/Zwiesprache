import { render } from 'preact';
import { Controller } from './chat/controller';
import { App } from './ui/App';
import { ControllerContext } from './ui/hooks';
import { playNotification } from './ui/sound';
import './ui/styles.css';

const controller = new Controller();
// Fragment vor dem ersten Rendern auswerten (entfernt es sofort aus URL und Verlauf).
controller.init();
controller.onIncomingMessage = () => {
  if (controller.state.settings.sound && (document.hidden || !document.hasFocus())) playNotification();
};

render(
  <ControllerContext.Provider value={controller}>
    <App />
  </ControllerContext.Provider>,
  document.getElementById('app')!,
);
