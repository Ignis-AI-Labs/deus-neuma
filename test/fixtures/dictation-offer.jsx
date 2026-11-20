// The desk's dictation client and setup card for managed-stt-hold-browser.test.js: window.stt is the
// real stt-client, window.showOffer renders the real DictationSetup in its graphics-card offer.
import { createRoot } from 'react-dom/client';
import * as stt from '../../frontend/app/RelinkShell/stt-client.js';
import { DictationSetup } from '../../frontend/app/RelinkShell/DictationSetup.jsx';

window.stt = stt;
window.showOffer = (upgrade) => createRoot(document.getElementById('root'))
  .render(<DictationSetup missing={[]} upgrade={upgrade} onDismiss={() => { window.dismissed = true; }} />);
