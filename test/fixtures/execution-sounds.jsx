import React from 'react';
import { createRoot } from 'react-dom/client';
// The engine initializes before render, exactly as main.jsx boots it — the
// section's labels come from the catalogs now.
import '../../frontend/i18n/index.js';
import { SoundSection } from '../../frontend/app/RelinkShell/SoundSection.jsx';
import { ToolChip } from '../../frontend/app/RelinkShell/ToolChip.jsx';
import { toHistoryMessages } from '../../frontend/app/RelinkShell/stream-reducer-messages.js';
import { executionPresentation } from '../../backend/services/execution-presentation.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';

const command = 'npm run build -- --output ' + 'a-long-project-folder/'.repeat(8) + 'bundle.js';
const messages = toHistoryMessages([{ role: 'assistant', content: '', tools: [{
  tool: 'coding/execute', status: 'ok', ...executionPresentation(command, { result: { exitCode: 0 } }),
  detail: 'stdout: build complete',
}] }], 0, 'proof');
createRoot(document.getElementById('root')).render(<main style={{ padding: 20 }}>
  <div id="execution"><ToolChip segment={messages[0].segments[0]} /></div>
  <SoundSection />
</main>);
