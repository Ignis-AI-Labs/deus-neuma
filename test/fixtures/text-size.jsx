import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import '../../frontend/i18n/index.js';
import { LookSection } from '../../frontend/app/RelinkShell/LookSection.jsx';
import CodeEditor from '../../frontend/app/RelinkShell/files/CodeEditor.jsx';
import { bootTextSize } from '../../frontend/services/text-size.js';
import { bootLook } from '../../frontend/services/look.js';
import { bindTerminalTextSize } from '../../frontend/app/RelinkShell/terminal/terminal-text-size.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';
import '../../frontend/app/RelinkShell/files/EditorApp.css';

bootLook();
bootTextSize();
const TerminalView = () => {
  const host = useRef(null);
  useEffect(() => {
    const term = new Terminal({ fontSize: 13 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    term.write('Readable terminal text');
    const unbind = bindTerminalTextSize(term, () => {
      fit.fit();
      host.current.dataset.fontSize = String(term.options.fontSize);
      host.current.dataset.cols = String(term.cols);
    });
    return () => { unbind(); term.dispose(); };
  }, []);
  return <div id="terminal" ref={host} style={{ width: '100%', height: 160 }} />;
};
createRoot(document.getElementById('root')).render(<main style={{ padding: 16 }}>
  <LookSection />
  <div className="settings-look-group-h" id="fixed">Small fixed label <span>inherited text</span></div>
  <p className="settings-note" id="relative">Token-sized prose <em>with emphasis</em></p>
  <div style={{ height: 150 }}><CodeEditor path="sample.js" doc="const readable = true;" loadId="sample" readOnly /></div>
  <TerminalView />
</main>);
