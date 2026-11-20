// AtlasMap — the memory drawn as a map: every topic a disc sized by how many
// memories it holds, every memory a dot inside its topic (brighter = newer,
// larger = more connected). The few strongest ties between whole topics are
// drawn as lines; a memory's own links are drawn only while it is open. So the
// picture answers […] at a glance, where the old
// field drew every link at once and answered nothing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAtlasMapLayout } from './atlas-map-layout.js';
import { initialView, viewBoxOf, zoomBy, panBy, renderedBaseScale } from '../context-field-lens.js';

const SCALE = 2.2; // px per layout unit
const PAD = 24;
const TIES_SHOWN = 14;

/**
 * @param {{atlas: Object, lit: (Set<string>|null), openedId: (string|null), near: Array<{id:string}>, filters: Object,
 *   onOpen: (id: string) => void, onToggle: (key: string, value: any) => void}} props
 *   lit: the ids the current filters leave (null = no filter: all lit)
 */
export const AtlasMap = ({ atlas, lit, openedId, near, filters, onOpen, onToggle }) => {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [view, setView] = useState(null); // null = fit the whole map
  const layout = useMemo(() => buildAtlasMapLayout(atlas), [atlas]);
  const tx = (x) => PAD + (x - layout.bounds.minX) * SCALE;
  const ty = (y) => PAD + (y - layout.bounds.minY) * SCALE;
  const width = PAD * 2 + (layout.bounds.maxX - layout.bounds.minX) * SCALE;
  const height = PAD * 2 + (layout.bounds.maxY - layout.bounds.minY) * SCALE;
  const discOf = useMemo(() => new Map(layout.discs.map((d) => [d.topic, d])), [layout]);
  const dotOf = useMemo(() => new Map(layout.dots.map((d) => [d.id, d])), [layout]);
  const lineOf = useMemo(() => new Map(atlas.memories.map((m) => [m.id, m.line])), [atlas]);
  const strongest = atlas.ties.slice(0, TIES_SHOWN);
  const topTie = Math.max(1, ...strongest.map((t) => t.w));
  const opened = openedId ? dotOf.get(openedId) : null;

  const applyZoom = (factor) => setView((prev) => zoomBy(prev ?? initialView(width, height), factor));
  // A native, non-passive wheel listener: React's own are passive, so the pane would scroll under the zoom.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); applyZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || e.buttons === 0) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true; d.x = e.clientX; d.y = e.clientY;
    const rect = svgRef.current?.getBoundingClientRect();
    const s = renderedBaseScale(rect?.width, rect?.height, width, height);
    setView((prev) => panBy(prev ?? initialView(width, height), dx / s, dy / s));
  };
  // A drag that moved is a pan, never a press on what lay under the pointer.
  const pressed = (act) => () => { if (!dragRef.current?.moved) act(); };

  return (
    <div className="atlas-map">
      <div className="atlas-map-bar">
        <span className="atlas-map-key label-data">A DISC IS A TOPIC · A DOT IS A MEMORY · BRIGHTER IS NEWER · LARGER IS MORE CONNECTED</span>
        <span className="atlas-zoom" role="group" aria-label="map zoom">
          <button type="button" className="atlas-btn" onClick={() => applyZoom(1 / 1.4)} aria-label="Zoom out">−</button>
          <button type="button" className="atlas-btn" onClick={() => applyZoom(1.4)} aria-label="Zoom in">+</button>
          <button type="button" className="atlas-btn label-data" onClick={() => setView(null)} aria-label="Fit the whole map">FIT</button>
        </span>
      </div>
      <div className="atlas-map-stage">
        <svg ref={svgRef} className="atlas-map-svg" viewBox={viewBoxOf(width, height, view ?? initialView(width, height))}
          preserveAspectRatio="xMidYMid meet" role="group" aria-label="memory map: topics and their memories"
          onPointerDown={(e) => { dragRef.current = { x: e.clientX, y: e.clientY, moved: false }; }}
          onPointerMove={onPointerMove}>
          {strongest.map((t) => {
            const a = discOf.get(t.a); const b = discOf.get(t.b);
            if (!a || !b) return null;
            return (
              <line key={`${t.a}:${t.b}`} className="atlas-tie" x1={tx(a.cx)} y1={ty(a.cy)} x2={tx(b.cx)} y2={ty(b.cy)}
                strokeWidth={1 + 5 * (t.w / topTie)}>
                <title>{`${a.name} and ${b.name} share memories that lie near each other`}</title>
              </line>
            );
          })}
          {layout.discs.map((d) => {
            const on = filters.topic === d.topic;
            return (
              <g key={d.topic} className={`atlas-disc${on ? ' is-on' : ''}${d.topic === -1 ? ' is-loose' : ''}`}>
                <circle cx={tx(d.cx)} cy={ty(d.cy)} r={d.r * SCALE} role="button" tabIndex={0} aria-pressed={on}
                  aria-label={`${d.name}: ${d.size} memories`}
                  onClick={pressed(() => onToggle('topic', d.topic))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle('topic', d.topic); } }} />
              </g>
            );
          })}
          {opened ? near.map((n) => {
            const other = dotOf.get(n.id);
            return other ? <line key={n.id} className="atlas-thread" x1={tx(opened.x)} y1={ty(opened.y)} x2={tx(other.x)} y2={ty(other.y)} /> : null;
          }) : null}
          {layout.dots.map((d) => {
            const dim = lit !== null && !lit.has(d.id);
            const isOpen = d.id === openedId;
            const isNear = !isOpen && opened && near.some((n) => n.id === d.id);
            return (
              <circle key={d.id} className={`atlas-dot${dim ? ' is-dim' : ''}${isOpen ? ' is-open' : ''}${isNear ? ' is-near' : ''}`}
                cx={tx(d.x)} cy={ty(d.y)} r={d.r * SCALE} style={{ fillOpacity: dim ? undefined : 0.95 - 0.7 * d.age }}
                onClick={pressed(() => onOpen(d.id))}>
                <title>{lineOf.get(d.id)}</title>
              </circle>
            );
          })}
          {/* Names last, so a thread never runs over one. */}
          {layout.discs.map((d) => (
            <text key={d.topic} className={`atlas-disc-name${filters.topic === d.topic ? ' is-on' : ''}`}
              x={tx(d.cx)} y={ty(d.cy - d.r) - 6} textAnchor="middle">{d.label.toUpperCase()}</text>
          ))}
        </svg>
      </div>
    </div>
  );
};
