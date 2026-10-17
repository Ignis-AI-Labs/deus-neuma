import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../frontend/i18n/index.js';
import { LookSection } from '../../frontend/app/RelinkShell/LookSection.jsx';
import { TabStrip } from '../../frontend/app/RelinkShell/TabStrip.jsx';
import { bootLook } from '../../frontend/services/look.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';

bootLook();
createRoot(document.getElementById('root')).render(<>
  <TabStrip tabs={[{ id: 'a', kind: 'local', neumaId: 'metidar', name: 'METIDAR' }]}
    focusedId="a" nextKind="local" liveIds={['a']}
    grounds={{ a: { short: 'METIDAR', full: '/workspaces/metidar' } }} />
  <div style={{ maxWidth: 800, margin: '20px auto' }}><LookSection /></div>
</>);
