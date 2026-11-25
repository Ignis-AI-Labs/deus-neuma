// The chat's composer with its ONE voice button: the real StreamInput, the real TalkButton
// (ComposerTools.jsx) in the slot ChatApp gives it, the real translations and styles. The sitting
// behind it is the stream hook's (use-consciousness-stream.js, a live portal); here the provider
// holds the one bit TALK reads and flips, voiceSittingActive, so the button's own wiring is what
// is proven. Served to test/integration/talk-composer-browser.test.js.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../frontend/i18n/index.js';
import '../../frontend/styles/tokens.css';
import '../../frontend/app/RelinkShell/RelinkShell.css';
import { StreamInput } from '../../frontend/app/RelinkShell/StreamInput.jsx';
import { TalkButton } from '../../frontend/app/RelinkShell/ComposerTools.jsx';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';

const Page = () => {
  const [voiceSittingActive, setActive] = useState(false);
  const [sent, setSent] = useState([]);
  const value = {
    voiceSittingActive,
    enterVoiceSitting: () => setActive(true),
    exitVoiceSitting: () => setActive(false),
  };
  return (
    <ConsciousnessProvider value={value}>
      <WindowManager registry={{}}>
      <div style={{ width: 900, padding: 24 }}>
        <output id="sitting">{voiceSittingActive ? 'sitting' : 'desk'}</output>
        <StreamInput connected onSend={(text) => setSent((s) => [...s, text])} talk={<TalkButton />} />
        <output id="sent">{sent.join('|')}</output>
      </div>
      </WindowManager>
    </ConsciousnessProvider>
  );
};

createRoot(document.getElementById('root')).render(<Page />);
window.composerReady = true;
