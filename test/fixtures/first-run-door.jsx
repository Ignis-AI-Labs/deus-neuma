// Render-only host for the first-run door: the real FirstRunChoice with the app's own styles,
// as AppShell mounts it. The door pressed lands on window.chosen. It also hosts the flight
// check's setup card (ModelServerSetup), which shares the door's setup hook.
import '../../frontend/styles/tokens.css';
import '../../frontend/styles/main.css';
import { createRoot } from 'react-dom/client';
import { FirstRunChoice } from '../../frontend/app/FirstRunChoice/FirstRunChoice.jsx';
import { ModelServerSetup } from '../../frontend/app/FirstRunChoice/ModelServerSetup.jsx';

window.chosen = null;
window.expired = 0;
window.addEventListener('neuma:auth_expired', () => { window.expired += 1; });
const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
let mounts = 0;
window.showDoor = () => {
  window.chosen = null;
  mounts += 1;
  root.render(<FirstRunChoice key={mounts} onChoose={(p) => { window.chosen = p; }} />);
};
window.showSetupCard = () => root.render(<ModelServerSetup onDone={() => {}} />);
window.hideDoor = () => root.render(null);
window.ready = true;
