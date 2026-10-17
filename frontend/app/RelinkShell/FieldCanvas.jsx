// FieldCanvas — the CONTEXT MAP's drawn FIELD, extracted whole from
// ContextMapApp (size law): the crystallized-memory graph pane — chips, lens,
// zoom/pan and the SVG — plus its pure edge thinning. The honest guard states
// (loading / failed read / empty field) stay with FieldView in ContextMapApp;
// this component has no early returns, so its wheel effect can close over the
// zoom handler directly (no render-phase ref writes; echo r3).

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildContextMapLayout } from './context-map-layout.js';
import { formatCount } from '../../utils/format.js';
import {
  applyFieldLens, initialView, viewBoxOf, zoomBy, panBy, renderedBaseScale,
} from './context-field-lens.js';

const FIELD_PAD = 18; // px margin around the drawn field
export const FIELD_SCALE = 2.4; // px per abstract layout unit
const EDGE_BUDGET = 600; // NFR-8 render budget — strongest links kept

// Pure — honest edge thinning for the render budget: past the budget only
// the strongest links (by real similarity weight) are drawn, and the view
// says so. Never a silent cut, never a locked-up pane.
export const thinFieldEdges = (edges, budget = EDGE_BUDGET) =>
  edges.length <= budget
    ? { kept: edges, thinned: false, total: edges.length }
    : {
        kept: [...edges].sort((a, b) => (b.w ?? 0) - (a.w ?? 0)).slice(0, budget),
        thinned: true,
        total: edges.length,
      };

export const FieldRefresh = ({ onRefresh }) => (
  <button type="button" className="ctx-field-refresh label-data" onClick={onRefresh}>
    REFRESH
  </button>
);

const betweennessText = (n) =>
  (Number.isFinite(n?.betweenness) ? n.betweenness : 0).toFixed(4);

// The presence chip row — the lane's mind-graph entities as filter handles:
// the witness wears SIGNAL, housemates the plain register, later kinds dim.
// A chip's title carries the relation truth (type × encounters).
const PresenceChips = ({ presences, lens, onLens }) => {
  // Boundary discipline (echo r2): the payload crossed the wire — a chip
  // renders only for a string-named entity, and never throws for a rotten one.
  const entities = (presences?.entities || [])
    .filter((e) => typeof e?.name === 'string' && e.name.length > 0)
    .sort((a, b) => (b.encounters ?? 0) - (a.encounters ?? 0));
  if (entities.length === 0) return null;
  const relationOf = (name) =>
    (presences?.relations || []).find((r) => typeof r?.to === 'string' && r.to.toLowerCase() === name.toLowerCase());
  return (
    <div className="ctx-field-presences" role="group" aria-label="presence filters">
      <span className="ctx-field-chip-h label-data">PRESENCES</span>
      {entities.map((e) => {
        const on = (lens.presence || '').toLowerCase() === e.name.toLowerCase();
        const rel = relationOf(e.name);
        return (
          <button
            key={e.name}
            type="button"
            className={`ctx-chip is-${e.kind || 'contact'}${on ? ' is-on' : ''}`}
            aria-pressed={on}
            title={`${rel ? `${rel.type} · ` : ''}×${formatCount(e.encounters ?? 0)} encounters`}
            onClick={() => onLens({ presence: on ? null : e.name })}
          >
            {e.name} <span className="ctx-chip-n">×{formatCount(e.encounters ?? 0)}</span>
          </button>
        );
      })}
    </div>
  );
};

const CommunityChips = ({ communities, lens, onLens }) => {
  if ((communities || []).length === 0) return null;
  return (
    <div className="ctx-field-communities" role="group" aria-label="community filters">
      <span className="ctx-field-chip-h label-data">COMMUNITIES</span>
      {communities.map((c, i) => (
        <button
          key={`${c.label}-${i}`}
          type="button"
          className={`ctx-chip${lens.community === i ? ' is-on' : ''}`}
          aria-pressed={lens.community === i}
          onClick={() => onLens({ community: lens.community === i ? null : i })}
        >
          {String(c.label || `#${i}`).toUpperCase()}
        </button>
      ))}
    </div>
  );
};

// The drawn field. No early returns — every hook runs on every render, so
// the native wheel listener (non-passive: React's root wheel listeners are
// passive and a JSX onWheel preventDefault would be a no-op while the pane
// scrolls) closes over the CURRENT applyZoom each commit.
export const FieldCanvas = ({ nodes, edges, communities, truncatedTo, presences, focusedId, onFocus, onRefresh }) => {
  const nodeRefs = useRef(new Map());
  // The lens (presence/community filters — DIM, never reflow) and the view
  // (zoom/pan over the drawn field). null view = FIT: the whole field.
  const [lens, setLens] = useState({ presence: null, community: null });
  const [view, setView] = useState(null);
  const dragRef = useRef(null); // { x, y, moved } during a pan gesture
  const svgRef = useRef(null);

  // The layout depends only on the graph — zoom/lens/drag renders must not
  // recompute it (echo r4 research note; a 500-node Brandes pass per wheel
  // tick would drop frames).
  const { kept, thinned, total } = useMemo(() => thinFieldEdges(edges), [edges]);
  const layout = useMemo(
    () => buildContextMapLayout({ nodes, edges: kept, communities }),
    [nodes, kept, communities],
  );
  const raw = useMemo(() => new Map(nodes.map((n) => [String(n.id), n])), [nodes]);
  const tx = (x) => FIELD_PAD + (x - layout.bounds.minX) * FIELD_SCALE;
  const ty = (y) => FIELD_PAD + (y - layout.bounds.minY) * FIELD_SCALE;
  const width = FIELD_PAD * 2 + (layout.bounds.maxX - layout.bounds.minX) * FIELD_SCALE;
  const height = FIELD_PAD * 2 + (layout.bounds.maxY - layout.bounds.minY) * FIELD_SCALE;

  const focused = focusedId != null ? raw.get(String(focusedId)) : null;
  const focusedCommunity =
    focused && Number.isInteger(focused.communityIndex) && focused.communityIndex >= 0
      ? communities[focused.communityIndex]
      : null;

  const focusByIndex = (i) => {
    const n = layout.nodes[i];
    if (n) nodeRefs.current.get(String(n.id))?.focus();
  };

  // The lens over the drawn nodes — unlit memories DIM in place, the layout
  // never reflows, and the count tells the honest truth of the cut.
  const lensState = applyFieldLens(nodes, lens);
  const isDim = (id) => lensState.active && !lensState.lit.has(String(id));
  const setLensPart = (part) => setLens((prev) => ({ ...prev, ...part }));

  // Zoom/pan (FIT = null view): buttons, native wheel, and background drag.
  // Both gestures use the UPDATER form — a wheel burst outpaces commits, and
  // a value-form set from render scope would overwrite instead of compound
  // (echo r4): every step chains off the latest committed view.
  const liveView = view ?? initialView(width, height);
  const applyZoom = (factor) =>
    setView((prev) => zoomBy(prev ?? initialView(width, height), factor));

  // Re-bound each commit (cheap, idempotent) so the handler's closure is
  // always this render's applyZoom — a committed side effect, never a
  // render-phase ref write.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheelNative = (e) => {
      e.preventDefault();
      applyZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  });

  // The SVG is CSS-sized to fill the stage (the viewBox letterboxes into it),
  // so a pointer pixel is worth base-scale world units — measured from the
  // live rect at gesture time, so a resized pane never desynchronizes a drag.
  const baseScale = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    return renderedBaseScale(rect?.width, rect?.height, width, height);
  };

  const onPointerDown = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || e.buttons === 0) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return; // a click, not a pan
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    const s = baseScale();
    setView((prev) => panBy(prev ?? initialView(width, height), dx / s, dy / s));
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div className="ctx-field">
      <div className="ctx-field-head">
        <div className="ctx-field-bar">
          <FieldRefresh onRefresh={onRefresh} />
          <span className="ctx-field-count label-data">
            {formatCount(layout.nodes.length)} MEMORIES · {formatCount(kept.length)} LINKS · {formatCount(layout.communityRings.length)} COMMUNITIES
          </span>
          <span className="ctx-field-zoom" role="group" aria-label="field zoom">
            <button type="button" className="ctx-zoom-btn" onClick={() => applyZoom(1 / 1.4)} aria-label="Zoom out">−</button>
            <button type="button" className="ctx-zoom-btn" onClick={() => applyZoom(1.4)} aria-label="Zoom in">+</button>
            <button type="button" className="ctx-zoom-btn ctx-zoom-fit" onClick={() => setView(null)} aria-label="Fit the whole field">FIT</button>
          </span>
          {truncatedTo ? (
            <span className="ctx-field-note label-data">
              SHOWING MOST RECENT {formatCount(truncatedTo)} OF MORE
            </span>
          ) : null}
          {thinned ? (
            <span className="ctx-field-note label-data">
              EDGES THINNED FOR RENDER — STRONGEST {formatCount(kept.length)} OF {formatCount(total)}
            </span>
          ) : null}
          {lensState.active ? (
            <span className="ctx-field-note ctx-field-lens-note label-data">
              LENS — {formatCount(lensState.shown)} OF {formatCount(lensState.total)} LIT
            </span>
          ) : null}
        </div>
        <PresenceChips presences={presences} lens={lens} onLens={setLensPart} />
        <CommunityChips communities={communities} lens={lens} onLens={setLensPart} />
        <div className="ctx-field-strip label-data">
          {focused ? (
            <>
              <span className="ctx-field-strip-label">{focused.label}</span>
              <span>DEGREE {formatCount(focused.degree ?? 0)}</span>
              <span>BETWEENNESS {betweennessText(focused)}</span>
              {focusedCommunity ? (
                <span>COMMUNITY {String(focusedCommunity.label || '').toUpperCase()}</span>
              ) : null}
              {(focused.presences || []).length > 0 ? (
                <span>SPEAKS OF {focused.presences.join(' · ').toUpperCase()}</span>
              ) : null}
            </>
          ) : (
            <span className="ctx-field-hint">FOCUS A NODE — its record reads out here. WHEEL zooms, DRAG pans.</span>
          )}
        </div>
      </div>

      {/* The stage takes every pixel the pane has left; the SVG fills it and
          the viewBox letterboxes the field into whatever aspect the witness
          sized the window to — the canvas follows the panel, always. */}
      <div className="ctx-field-stage">
      <svg
        ref={svgRef}
        className="ctx-field-svg"
        viewBox={viewBoxOf(width, height, liveView)}
        preserveAspectRatio="xMidYMid meet"
        role="list"
        aria-label="crystallized memory field"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {layout.communityRings.map((ring, i) => {
          // Ring radius from the real member positions — reaches just past
          // the farthest member; a memberless detected community keeps a
          // small honest ring rather than a fabricated extent.
          const rr = layout.nodes
            .filter((n) => n.communityIndex === i)
            .reduce((m, n) => Math.max(m, Math.hypot(n.x - ring.cx, n.y - ring.cy) + n.r + 4), 6);
          return (
            <circle
              key={`ring-${ring.label}-${i}`}
              className="ctx-field-ring"
              cx={tx(ring.cx)}
              cy={ty(ring.cy)}
              r={rr * FIELD_SCALE}
            />
          );
        })}
        {layout.edges.map((e) => (
          <line
            key={`${String(e.source)}>${String(e.target)}`}
            className={`ctx-field-edge${isDim(e.source) || isDim(e.target) ? ' is-dim' : ''}`}
            x1={tx(e.x1)}
            y1={ty(e.y1)}
            x2={tx(e.x2)}
            y2={ty(e.y2)}
          />
        ))}
        {layout.nodes.map((n, idx) => {
          const id = String(n.id);
          const src = raw.get(id);
          return (
            <g
              key={id}
              className="ctx-field-node"
              role="listitem"
              tabIndex={0}
              aria-label={`${n.label} — degree ${src?.degree ?? 0}, betweenness ${betweennessText(src)}`}
              ref={(el) => {
                if (el) nodeRefs.current.set(id, el);
                else nodeRefs.current.delete(id);
              }}
              onFocus={() => onFocus(id)}
              onClick={() => onFocus(id)}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
                  : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (step !== 0) {
                  e.preventDefault();
                  focusByIndex(idx + step);
                }
              }}
            >
              <title>{n.label}</title>
              <circle
                className={`ctx-field-dot${focusedId === id ? ' is-focused' : ''}${isDim(id) ? ' is-dim' : ''}`}
                cx={tx(n.x)}
                cy={ty(n.y)}
                r={Math.max(n.r * FIELD_SCALE, 2)}
              />
            </g>
          );
        })}
      </svg>
      </div>
    </div>
  );
};
