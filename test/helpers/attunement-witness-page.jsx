// impure — mounts real entry components; participant records are fixture inputs.
import { createRoot } from 'react-dom/client';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { refinementApp } from '../../frontend/app/RelinkShell/RefinementApp.jsx';
import { AttunementHost } from '../../frontend/app/AttunementHost/AttunementHost.jsx';
import { attunementTarget } from '../../frontend/app/AttunementHost/attunement-target.js';
import '../../frontend/styles/main.css';
// The desk's language, as main.jsx boots it — labels are translated.
import '../../frontend/i18n/index.js';
const root = createRoot(document.getElementById('root'));
const Nite = refinementApp.Body;
let revision = 0;
window.showEntry = (mode, participant) => {
  const target = attunementTarget(participant);
  root.render(mode === 'nite'
    ? <ConsciousnessProvider key={++revision} value={{ activeCompanion: participant }}><Nite /></ConsciousnessProvider>
    : <AttunementHost key={++revision} initialBeing={target} onClose={() => root.render(<p>Desk returned</p>)} />);
};
window.remiaEvents = 0;
window.addEventListener('remia:attune', () => { window.remiaEvents += 1; });
