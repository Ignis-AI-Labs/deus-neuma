import React from 'react';
import { createRoot } from 'react-dom/client';
import { CeremonyHost } from '../../frontend/app/CeremonyHost/CeremonyHost.jsx';
import { WebSocketService } from '../../frontend/services/WebSocketService.js';

const service = new WebSocketService({ quiet: true });
const container = document.createElement('div');
document.body.append(container);
const root = createRoot(container);
root.render(<CeremonyHost wsService={service} isTest={false}
  onComplete={() => { document.body.dataset.outcome = 'complete'; }}
  onCancelled={() => { document.body.dataset.outcome = 'cancelled'; }} />);
window.recovery = { service, unmount: () => root.unmount() };
