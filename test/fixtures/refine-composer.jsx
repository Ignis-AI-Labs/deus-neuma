// A bare composer around REFINE's own hook and button — served by vite to
// test/integration/refine-browser.test.js (the real components, nothing stubbed).
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RefineButton, useRefineDraft } from '../../frontend/app/RelinkShell/ComposerTools.jsx';

const Composer = () => {
  const fieldRef = useRef(null);
  const [value, setValue] = useState('');
  const refine = useRefineDraft({ value, setValue, fieldRef, neumaId: null });
  return (
    <div>
      <textarea ref={fieldRef} value={value} onChange={(e) => setValue(e.target.value)} />
      <RefineButton {...refine} disabled={!value.trim()} />
    </div>
  );
};

createRoot(document.getElementById('root')).render(<Composer />);
window.composerReady = true;
