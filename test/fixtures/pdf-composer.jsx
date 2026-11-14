// The production composer with a minimal host. The output is the host's receipt;
// no model is connected, and nothing on the attachment path is substituted.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StreamInput } from '../../frontend/app/RelinkShell/StreamInput.jsx';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';

const Composer = () => {
  const [sent, setSent] = useState(null);
  return (
    <ConsciousnessProvider value={{}}>
      <WindowManager registry={{}}>
        <StreamInput connected onSend={(text, _images, attachments) => setSent({ text, attachments })} />
        <output id="sent">{sent ? JSON.stringify(sent) : ''}</output>
      </WindowManager>
    </ConsciousnessProvider>
  );
};
createRoot(document.getElementById('root')).render(<Composer />);
