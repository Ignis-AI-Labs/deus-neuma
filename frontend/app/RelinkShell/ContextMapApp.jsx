// ContextMapApp — CONTEXT MAP. The context window's anatomy drawn from real
// telemetry only: the portal's context:composition event (counts, never the
// assembled text). Two views: COMPOSITION (the window's anatomy per turn —
// CompositionView.jsx) and FIELD (the crystallized-memory graph — the drawn
// pane lives in FieldCanvas.jsx; the honest guard states stay here in
// FieldView: server-computed nodes/edges/communities, real betweenness-scaled
// radii, honest empty/error/degradation states, never an invented graph).

import { useState } from 'react';
import './ContextMapApp.css';
import './ContextMapApp-composition.css';
import { useActiveCompanion } from './consciousness-context.js';
import { useSettled } from './use-settled.js';
import { DeskTabs } from './DeskTabs.jsx';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useCompositionEvent } from './composition-context.js';
import { loadMemoryGraph } from './graph-client.js';
import { CompositionView } from './CompositionView.jsx';
import { FieldCanvas, FieldRefresh } from './FieldCanvas.jsx';

// Re-exports for the readers pinned to this path (the component-level vitests
// import the views and the field pures from here).
export { TokenFigure, CompositionView } from './CompositionView.jsx';
export { FIELD_SCALE, thinFieldEdges } from './FieldCanvas.jsx';

const ContextMapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="1.5" y="3" width="13" height="4" />
    <path d="M5.5 3 V7 M10 3 V7" />
    <rect x="1.5" y="10" width="6" height="3" />
    <rect x="10.5" y="10" width="4" height="3" />
  </svg>
);

// ————— FIELD — the crystallized-memory graph (F-03) —————

// Pure view of the field. field: undefined = read in flight;
// {ok:false,status} = honest failure; {ok:true,graph} = the real record.
// Exported for the component-level vitest (real layout, real render).
// The guards live HERE; the drawn field lives in FieldCanvas.jsx — a
// component with no early returns, so its wheel effect can close over the
// zoom handler directly (no render-phase ref writes; echo r3).
export const FieldView = ({ field, focusedId, onFocus, onRefresh }) => {
  if (field === undefined) {
    return <EmptyState title="READING THE FIELD…" />;
  }

  if (!field.ok) {
    return (
      <EmptyState
        title={`THE FIELD COULD NOT BE READ${Number.isFinite(field.status) ? ` — HTTP ${field.status}` : ''}`}
      >
        <small>
          A failed read draws nothing — this pane never invents a graph.
          REFRESH asks the platform again.
        </small>
        <FieldRefresh onRefresh={onRefresh} />
      </EmptyState>
    );
  }

  const { nodes = [], edges = [], communities = [], truncatedTo } = field.graph || {};

  if (nodes.length === 0) {
    return (
      <EmptyState title="NO CRYSTALLIZED FIELD YET">
        <small>
          The graph grows as memories form — nothing has crystallized in this
          workspace, so nothing is drawn.
        </small>
        <FieldRefresh onRefresh={onRefresh} />
      </EmptyState>
    );
  }

  return (
    <FieldCanvas
      nodes={nodes}
      edges={edges}
      communities={communities}
      truncatedTo={truncatedTo}
      presences={field.graph?.presences}
      focusedId={focusedId}
      onFocus={onFocus}
      onRefresh={onRefresh}
    />
  );
};

// impure — fetches the graph once per tab activation (and again only on the
// witness's REFRESH — no polling); all display logic stays in FieldView.
const FieldBody = () => {
  const neumaId = useActiveCompanion()?.neumaId || null;
  const [field, setField] = useState(undefined);
  const [focusedId, setFocusedId] = useState(null);
  const [readSeq, setReadSeq] = useState(0);

  useSettled((settled) => {
    setField(undefined);
    setFocusedId(null);
    loadMemoryGraph(neumaId).then((r) => { if (!settled()) setField(r); });
  }, [neumaId, readSeq]);

  return (
    <FieldView
      // A fresh lane is a fresh lens: the key remounts FieldView on a being
      // switch so lens/view/drag state can never leak across lanes (echo r1
      // — a stale presence filter would dim B's whole field with no chip to
      // clear it, since B's chips only name B's own presences).
      key={neumaId || 'none'}
      field={field}
      focusedId={focusedId}
      onFocus={setFocusedId}
      onRefresh={() => setReadSeq((s) => s + 1)}
    />
  );
};

const VIEWS = [
  { id: 'composition', label: 'COMPOSITION' },
  { id: 'field', label: 'FIELD' },
];

const ContextMapBody = () => {
  const composition = useCompositionEvent();
  const [view, setView] = useState('composition');

  return (
    <div className="ctx">
      <DeskTabs items={VIEWS} value={view} onChange={setView} label="Context map views"
        className="ctx-tabs" tabClassName="ctx-tab label-data"
        panelClassName={`ctx-scroll${view === 'field' ? ' is-field' : ''}`}>
        {view === 'composition' ? <CompositionView composition={composition} /> : <FieldBody />}
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
