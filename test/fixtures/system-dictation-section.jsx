// The real SystemDictationSection for system-dictation-browser.test.js.
import { createRoot } from 'react-dom/client';
import { SystemDictationSection } from '../../frontend/app/RelinkShell/SystemDictationSection.jsx';

createRoot(document.body.appendChild(document.createElement('div'))).render(<SystemDictationSection />);
