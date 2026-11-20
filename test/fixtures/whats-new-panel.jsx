// The real WHAT'S NEW panel (UpdateBar.jsx WhatsNewPanel) with its real styles, holding notes the
// length of 0.1.137's (five sections, about forty points), the ones the report was made on
// (deus-neuma #37). Served to test/integration/whats-new-scroll-browser.test.js.
import { createRoot } from 'react-dom/client';
import '../../frontend/styles/main.css';
import { WhatsNewPanel } from '../../frontend/app/RelinkShell/UpdateBar.jsx';

const sections = ['Dictation', 'Chats', 'Your house', 'Marketing', 'Models and tools'];
const body = sections.map((name) => `**${name}**\n${Array.from({ length: 8 }, (_, i) =>
  `- ${name} point ${i + 1}: a line of release notes long enough to wrap across the panel once or twice, as the real ones do.`).join('\n')}`)
  .join('\n\n') + '\n\nTHE LAST LINE OF THE NOTES.';
createRoot(document.getElementById('root')).render(
  <WhatsNewPanel title="WHAT'S NEW IN 0.1.137" version="0.1.137" notes={[{ version: '0.1.137', body }]}
    onClose={() => { window.closeCount = (window.closeCount || 0) + 1; }} />,
);
window.panelReady = true;
