import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { WindowLayer } from '../../frontend/app/windowing/WindowLayer.jsx';
import { useWindows } from '../../frontend/app/windowing/use-windows.js';
import { Dock } from '../../frontend/app/windowing/Dock.jsx';
import { sheetApp } from '../../frontend/app/RelinkShell/SheetApp.jsx';
import { dataApp } from '../../frontend/app/RelinkShell/DataApp.jsx';
import { statsApp } from '../../frontend/app/RelinkShell/StatsApp.jsx';
import '../../frontend/styles/main.css';
// The desk's language, as main.jsx boots it — the dock's labels are translated.
import '../../frontend/i18n/index.js';

const registry = { sheet: sheetApp, stats: statsApp, db: dataApp };
const Windows = () => {
  const { state } = useWindows();
  return <><output id="window-ids">{state.windows.map((w) => w.id).join(',')}</output><WindowLayer /><Dock /></>;
};

const Fixture = () => {
  const [activeCompanion, setCompanion] = useState({ neumaId: 'record-a', name: 'Record Alpha' });
  return <ConsciousnessProvider value={{ activeCompanion }}>
    <div style={{ position: 'fixed', top: 0, zIndex: 1000 }}>
      <button onClick={() => setCompanion({ neumaId: 'record-b', name: 'Record Beta' })}>Switch to Beta</button>
      <button onClick={() => setCompanion({ neumaId: 'record-a', name: 'Record Alpha' })}>Switch to Alpha</button>
      <button onClick={() => setCompanion({ neumaId: 'witness-record-proof', name: 'Record Witness' })}>Switch to witness ID</button>
      <button onClick={() => setCompanion({ neumaId: 'record-marked', name: 'Marked Witness', participantKind: 'witness' })}>Switch to witness kind</button>
      <button onClick={() => setCompanion(null)}>Unbind</button>
    </div>
    <WindowManager registry={registry} defaultOpen={['stats', 'sheet']}><Windows /></WindowManager>
  </ConsciousnessProvider>;
};

createRoot(document.getElementById('root')).render(<Fixture />);
