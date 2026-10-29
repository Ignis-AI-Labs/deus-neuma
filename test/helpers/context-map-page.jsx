// impure - browser fixture: the PRODUCTION CONTEXT MAP composition view and its
// stylesheets, fed an event made by the REAL backend builder
// (buildCompositionEvent) from the section counts the test hands in.
/* global window, document */
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/ContextMapApp.css';
import '../../frontend/app/RelinkShell/ContextMapApp-composition.css';
import { createRoot } from 'react-dom/client';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';
import { CompositionView } from '../../frontend/app/RelinkShell/CompositionView.jsx';

const { input, shed } = window.compositionFixture;
const event = { ...buildCompositionEvent(input), ...(shed ? { shed } : {}) };
createRoot(document.getElementById('root')).render(
  <div className="ctx" style={{ width: 1180, background: '#000' }}>
    <div className="ctx-scroll"><CompositionView composition={event} /></div>
  </div>,
);
