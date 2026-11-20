// ContextMapApp — CONTEXT MAP. Two views of what a being holds:
//
//   WINDOW — what the model is holding RIGHT NOW: the context window's anatomy
//   per turn, drawn from the portal's context:composition event (counts, never
//   the assembled text). CompositionView.jsx.
//
//   MEMORY — everything the being has KEPT: its memories by topic, person,
//   month and kind, searchable, each one openable in full with the memories
//   nearest to it. memory-atlas/MemoryAtlas.jsx.
//
// Both draw from real records only — a failed read draws nothing.

import { useState } from 'react';
import './ContextMapApp.css';
import './ContextMapApp-composition.css';
import { DeskTabs } from './DeskTabs.jsx';
import { AppTitle } from './app-title.jsx';
import { useCompositionEvent } from './composition-context.js';
import { CompositionView } from './CompositionView.jsx';
import { MemoryAtlas } from './memory-atlas/MemoryAtlas.jsx';

// Re-exports for the readers pinned to this path (the component-level vitests).
export { TokenFigure, CompositionView } from './CompositionView.jsx';

const ContextMapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="1.5" y="3" width="13" height="4" />
    <path d="M5.5 3 V7 M10 3 V7" />
    <rect x="1.5" y="10" width="6" height="3" />
    <rect x="10.5" y="10" width="4" height="3" />
  </svg>
);

const VIEWS = [
  { id: 'window', label: 'WINDOW · THIS TURN' },
  { id: 'memory', label: 'MEMORY · EVERYTHING KEPT' },
];

const ContextMapBody = () => {
  const composition = useCompositionEvent();
  const [view, setView] = useState('window');

  return (
    <div className="ctx">
      <DeskTabs items={VIEWS} value={view} onChange={setView} label="Context map views"
        className="ctx-tabs" tabClassName="ctx-tab label-data"
        panelClassName={`ctx-scroll${view === 'memory' ? ' is-memory' : ''}`}>
        {view === 'window' ? <CompositionView composition={composition} /> : <MemoryAtlas />}
      </DeskTabs>
    </div>
  );
};

export const contextMapApp = {
  label: 'CONTEXT MAP',
  labelKey: 'apps.contextmap',
  icon: <ContextMapIcon />,
  title: <AppTitle label="CONTEXT MAP" labelKey="apps.contextmap" />,
  Body: ContextMapBody,
  storageKey: 'contextmap',
};
