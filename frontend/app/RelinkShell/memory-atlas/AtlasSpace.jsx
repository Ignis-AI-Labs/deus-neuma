// AtlasSpace — the memory as a space to move through. Every memory is a point
// of light, every topic a cluster of them; drag to turn the whole, wheel to
// move in and out, press a topic's name to go and stand before it, press a
// memory to open it. Choosing a topic in the rail carries the camera there.
//
// It is the same atlas as the list and the flat map, drawn a third way: for
// looking around in, where the list is for finding and the map for the whole
// at a glance. Brighter is newer, larger is more connected, and the opened
// memory's threads to its nearest are the only lines between memories.
//
// Drawn on a canvas (thousands of points each frame); the geometry and the
// camera are atlas-space.js. It moves only while something moves it, plus a
// slow turn at rest that DRIFT switches off and that never starts for someone
// who asked their system for reduced motion.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  between, buildAtlasSpace, cameraToward, dolly, homeCamera, orbit, project, starAt,
} from './atlas-space.js';
import { discLabel } from './atlas-map-layout.js';

const FLIGHT_MS = 900;
const DRIFT_PER_MS = 0.00004;
const now = () => globalThis.performance.now();
const stillAsked = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * @param {{atlas: Object, lit: (Set<string>|null), openedId: (string|null), near: Array<{id:string}>, filters: Object,
 *   onOpen: (id: string) => void, onToggle: (key: string, value: any) => void}} props
 */
export const AtlasSpace = ({ atlas, lit, openedId, near, filters, onOpen, onToggle }) => {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const space = useMemo(() => buildAtlasSpace(atlas), [atlas]);
  const lineOf = useMemo(() => new Map(atlas.memories.map((m) => [m.id, m.line])), [atlas]);
  const starOf = useMemo(() => new Map(space.stars.map((s) => [s.id, s])), [space]);
  const ties = useMemo(() => atlas.ties.slice(0, 14), [atlas]);
  const topTie = Math.max(1, ...ties.map((t) => t.w));
  const [drift, setDrift] = useState(() => !stillAsked());
  const [hover, setHover] = useState(null); // {id, x, y}
  // Where the camera last ARRIVED ("whole", "topic:3", "memory:<id>") — a flight still in the air has not.
  const [arrived, setArrived] = useState('');
  // What the frame loop reads. Kept in refs so a frame never waits on a render.
  const camera = useRef(homeCamera(space));
  const flight = useRef(null); // {from, to, t0}
  const drawn = useRef({ stars: [], labels: [] });
  const drag = useRef(null);
  const live = useRef({});
  live.current = { lit, openedId, near, filters, drift };

  const flyTo = (to, key) => { flight.current = { from: camera.current, to, t0: now(), key }; };

  // The camera follows the choice: an opened memory, else the chosen topic, else the whole.
  useEffect(() => {
    const star = openedId ? starOf.get(openedId) : null;
    const cluster = Number.isInteger(filters.topic) ? space.clusters.find((c) => c.topic === filters.topic) : null;
    if (star) flyTo(cameraToward(camera.current, star, 9), `memory:${star.id}`);
    else if (cluster) flyTo(cameraToward(camera.current, cluster, cluster.r), `topic:${cluster.topic}`);
    else flyTo({ ...homeCamera(space), yaw: camera.current.yaw, pitch: camera.current.pitch }, 'whole');
  }, [space, starOf, openedId, filters.topic]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return undefined;
    const ctx = canvas.getContext('2d');
    const css = globalThis.getComputedStyle(stage);
    const ink = css.color || 'rgb(228, 234, 240)'; // the theme's own text colour
    const signal = css.getPropertyValue('--signal').trim() || '#4FD6E8';
    const font = css.getPropertyValue('--font-data').trim() || 'monospace';
    let frame = 0;
    let last = now();
    let size = { w: 0, h: 0 };
    const fit = () => {
      const rect = stage.getBoundingClientRect();
      const ratio = globalThis.devicePixelRatio || 1;
      size = { w: rect.width, h: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const paint = () => {
      const { w, h } = size;
      const state = live.current;
      const cam = camera.current;
      ctx.clearRect(0, 0, w, h);
      const placed = [];
      for (const s of space.stars) {
        const p = project(cam, s, w, h);
        if (p) placed.push({ ...p, id: s.id, star: s });
      }
      placed.sort((a, b) => b.depth - a.depth); // far first, so near lies over far
      const nearIds = new Set((state.near || []).map((n) => n.id));
      const open = state.openedId ? placed.find((p) => p.id === state.openedId) : null;
      // Each cluster's own bounds as a faint ring, and the strongest ties between topics as faint lines.
      const centres = new Map();
      for (const c of space.clusters) { const p = project(cam, c, w, h); if (p) centres.set(c.topic, { ...p, cluster: c }); }
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink;
      for (const c of centres.values()) {
        ctx.globalAlpha = state.filters.topic === c.cluster.topic ? 0.5 : 0.13;
        ctx.strokeStyle = state.filters.topic === c.cluster.topic ? signal : ink;
        if (c.cluster.topic === -1) ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.arc(c.sx, c.sy, c.cluster.r * c.scale, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = ink;
      for (const tie of ties) {
        const a = centres.get(tie.a); const b = centres.get(tie.b);
        if (!a || !b) continue;
        ctx.globalAlpha = 0.06 + 0.16 * (tie.w / topTie);
        ctx.lineWidth = 1 + 2 * (tie.w / topTie);
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
      if (open) {
        ctx.strokeStyle = signal;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        for (const p of placed) {
          if (!nearIds.has(p.id)) continue;
          ctx.beginPath(); ctx.moveTo(open.sx, open.sy); ctx.lineTo(p.sx, p.sy); ctx.stroke();
        }
      }
      for (const p of placed) {
        const isOpen = p.id === state.openedId;
        const isNear = nearIds.has(p.id);
        const dim = state.lit !== null && !state.lit.has(p.id);
        const radius = Math.max(1.3, Math.min(16, p.star.size * p.scale * 0.8));
        // Far lights fade a little; older ones are fainter; one the choices leave out nearly goes.
        const fade = Math.max(0.35, Math.min(1, (cam.dist * 1.2) / p.depth));
        const alpha = isOpen || isNear ? 1 : dim ? 0.07 : (0.95 - 0.6 * p.star.age) * fade;
        ctx.fillStyle = isOpen || isNear ? signal : ink;
        if (!dim) { ctx.globalAlpha = alpha * 0.13; ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.min(radius * 3, radius + 12), 0, Math.PI * 2); ctx.fill(); } // its glow
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, isOpen ? radius + 2 : radius, 0, Math.PI * 2); ctx.fill();
        if (isOpen) { ctx.globalAlpha = 1; ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.sx, p.sy, radius + 6, 0, Math.PI * 2); ctx.stroke(); }
      }
      // Topic names: the chosen one, then nearest first; a name that would lie over one already written waits
      // until the space is turned or the camera moves in.
      ctx.font = `13px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const boxes = [];
      const chosen = Number.isInteger(state.filters.topic) ? centres.get(state.filters.topic) ?? null : null;
      const named = [...centres.values()].sort((a, b) => (state.filters.topic === b.cluster.topic) - (state.filters.topic === a.cluster.topic) || a.depth - b.depth);
      for (const l of named) {
        const on = state.filters.topic === l.cluster.topic;
        const text = `${discLabel(l.cluster.name).toUpperCase()} · ${l.cluster.size}`;
        const width = ctx.measureText(text).width;
        const y = l.sy - l.cluster.r * l.scale - 6;
        const box = { topic: l.cluster.topic, left: l.sx - width / 2 - 6, right: l.sx + width / 2 + 6, top: y - 20, bottom: y + 4 };
        if (boxes.some((k) => box.left < k.right && k.left < box.right && box.top < k.bottom && k.top < box.bottom)) continue;
        // A name from behind never lies across the cluster the camera came to see.
        if (!on && chosen && l.depth > chosen.depth && Math.hypot(l.sx - chosen.sx, y - chosen.sy) < chosen.cluster.r * chosen.scale) continue;
        ctx.globalAlpha = on ? 1 : Math.max(0.3, Math.min(0.9, ((cam.dist * 1.1) / l.depth) ** 2));
        ctx.fillStyle = on ? signal : ink;
        ctx.fillText(text, l.sx, y);
        boxes.push(box);
      }
      ctx.globalAlpha = 1;
      drawn.current = { stars: placed, labels: boxes };
    };
    const tick = () => {
      const t = now();
      const elapsed = t - last;
      last = t;
      const f = flight.current;
      if (f) {
        const k = (t - f.t0) / FLIGHT_MS;
        camera.current = between(f.from, f.to, k);
        if (k >= 1) { flight.current = null; setArrived(f.key); }
      } else if (live.current.drift && !drag.current) {
        camera.current = { ...camera.current, yaw: camera.current.yaw + elapsed * DRIFT_PER_MS };
      }
      paint();
      frame = globalThis.requestAnimationFrame(tick);
    };
    fit();
    const watch = new globalThis.ResizeObserver(fit);
    watch.observe(stage);
    frame = globalThis.requestAnimationFrame(tick);
    // A native, non-passive wheel listener: React's own are passive, so the pane would scroll under the move.
    const onWheel = (e) => { e.preventDefault(); flight.current = null; camera.current = dolly(camera.current, e.deltaY < 0 ? 0.88 : 1 / 0.88, space); };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => { globalThis.cancelAnimationFrame(frame); watch.disconnect(); canvas.removeEventListener('wheel', onWheel); };
  }, [space, ties, topTie]);

  const at = (e) => { const r = canvasRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const labelAt = ({ x, y }) => drawn.current.labels.find((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) ?? null;
  const onPointerDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (d && e.buttons !== 0) {
      const dx = e.clientX - d.x; const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true; d.x = e.clientX; d.y = e.clientY;
      flight.current = null;
      camera.current = orbit(camera.current, dx, dy);
      if (hover) setHover(null);
      return;
    }
    const p = at(e);
    const id = starAt(drawn.current.stars, p.x, p.y);
    if (id !== (hover?.id ?? null) || (id && (Math.abs(p.x - hover.x) > 6 || Math.abs(p.y - hover.y) > 6))) setHover(id ? { id, ...p } : null);
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const p = at(e);
    const id = starAt(drawn.current.stars, p.x, p.y);
    if (id) { onOpen(id); return; }
    const label = labelAt(p);
    if (label) onToggle('topic', label.topic);
  };
  const onKeyDown = (e) => {
    const turn = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] }[e.key];
    if (turn) { e.preventDefault(); flight.current = null; camera.current = orbit(camera.current, turn[0], turn[1]); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); camera.current = dolly(camera.current, 0.8, space); }
    else if (e.key === '-') { e.preventDefault(); camera.current = dolly(camera.current, 1.25, space); }
  };

  return (
    <div className="atlas-map atlas-space">
      <div className="atlas-map-bar">
        <span className="atlas-map-key label-data">A CLUSTER IS A TOPIC · A LIGHT IS A MEMORY · DRAG TURNS · WHEEL MOVES IN AND OUT · PRESS A NAME TO GO THERE</span>
        <span className="atlas-zoom" role="group" aria-label="moving through the space">
          <button type="button" className="atlas-btn" onClick={() => { camera.current = dolly(camera.current, 1.3, space); }} aria-label="Move out">−</button>
          <button type="button" className="atlas-btn" onClick={() => { camera.current = dolly(camera.current, 1 / 1.3, space); }} aria-label="Move in">+</button>
          <button type="button" className="atlas-btn label-data" onClick={() => flyTo(homeCamera(space), 'whole')} aria-label="See the whole space">WHOLE</button>
          <button type="button" className={`atlas-btn label-data${drift ? ' is-on' : ''}`} aria-pressed={drift} onClick={() => setDrift(!drift)}>DRIFT</button>
        </span>
      </div>
      <div className="atlas-space-stage" ref={stageRef}>
        {/* The list beside this view is the same memories as text; the canvas is a picture of them to move through. */}
        <canvas ref={canvasRef} className="atlas-space-canvas" tabIndex={0} role="img" data-at={arrived}
          aria-label={`${atlas.memories.length} memories in ${space.clusters.length} clusters. Arrow keys turn, plus and minus move in and out. The LIST shows the same memories as a table.`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)} onKeyDown={onKeyDown} />
        {hover ? <p className="atlas-space-tip" style={{ left: hover.x, top: hover.y }}>{lineOf.get(hover.id) || '(no words kept)'}</p> : null}
      </div>
    </div>
  );
};
