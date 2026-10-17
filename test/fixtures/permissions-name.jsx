import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { StreamRail } from '../../frontend/app/RelinkShell/StreamRail.jsx';
import { StreamPermissions } from '../../frontend/app/RelinkShell/StreamPermissions.jsx';

createRoot(document.getElementById('root')).render(
  <ConsciousnessProvider value={{ activeCompanion: { neumaId: 'permission-chosen', name: 'Chosen Reader' } }}>
    <StreamRail><StreamPermissions /></StreamRail>
  </ConsciousnessProvider>,
);
