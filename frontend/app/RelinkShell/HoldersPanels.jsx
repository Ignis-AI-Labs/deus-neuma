// HoldersPanels — WHO HOLDS THE MACHINE, and THE IMAGE ENGINE, in the
// SUBSTRATE window (Design note, 2026-11-20: […]).
//
// Three sheets side by side — the graphics card, system memory, the CPU —
// every holder named by what it IS (the mind and its model file, the image
// engine, a voice engine, a browser), where the bar this replaces named the
// card's largest holder "PID 4046872". Under them every core as a cell with
// the holder on the busy ones. Then the image engine: its state, what its
// models hold, WHICH models it has loaded, and UNLOAD / STOP.
//
// It polls its own two reads, only while it can be seen (use-visible-interval.js).

import { useCallback, useEffect, useRef, useState } from 'react';
import './HoldersPanels.css';
import { Panel } from './sub-panel.jsx';
import { StackBar } from './hud-instruments.jsx';
import { Sheet } from './sheet/Sheet.jsx';
import { useVisibleInterval } from './use-visible-interval.js';
import { loadHolders, loadImageEngine } from './holders-client.js';
import { freeForge, stopForge } from '../../services/image-forge-client.js';
import { cardBarParts, coreStep, engineView, gbWords, holderName } from './holders-view.js';

const POLL_MS = 4000;
const ours = (h) => (h.ours ? 'on' : null);
const nameColumn = { head: 'HOLDER', cell: holderName, tone: ours, title: (h) => `${h.ours ? 'Started or managed by this platform. ' : ''}pid ${h.pids.join(', ')}` };

/** Pure view of the holders map: undefined = first read in flight, null = unanswered. */
export const HoldersView = ({ map, span = 12 }) => {
  if (map === undefined) return <Panel title="WHO HOLDS THE MACHINE" span={span}><p className="sub-empty-row label-data">READING…</p></Panel>;
  if (map === null) return <Panel title="WHO HOLDS THE MACHINE" span={span}><p className="hud-down label-data">UNAVAILABLE — the platform did not answer</p></Panel>;
  const { gpu, ram, cpu } = map;
  return (
    <Panel title="WHO HOLDS THE MACHINE" aside="CYAN = STARTED BY THIS PLATFORM" span={span} className="hold">
      <div className="hold-cols">
        <section className="hold-col" aria-label="graphics card memory">
          <h4 className="hold-h label-data">GRAPHICS CARD <b>{gpu ? `${gbWords(gpu.usedMB)} OF ${gbWords(gpu.totalMB)} · ${gbWords(gpu.freeMB)} FREE` : 'NO READING'}</b></h4>
          {gpu ? <StackBar parts={cardBarParts(gpu)} total={gpu.totalMB} legend={false} /> : <p className="hold-note">{map.gpuWhy}</p>}
          {gpu ? (
            <Sheet label="card holders" rows={gpu.holders} rowKey={(h) => `${h.label}:${h.pids[0]}`}
              columns={[nameColumn, { head: 'HOLDS', cell: (h) => gbWords(h.vramMB), sort: (h) => h.vramMB }]}
              empty={<p className="hold-note">Nothing holds the card.</p>} />
          ) : null}
          {gpu?.unattributedMB > 256 ? <p className="hold-note">{gbWords(gpu.unattributedMB)} is held with no holder the driver names.</p> : null}
        </section>
        <section className="hold-col" aria-label="system memory">
          <h4 className="hold-h label-data">SYSTEM MEMORY <b>{ram ? `${gbWords(ram.usedMB)} OF ${gbWords(ram.totalMB)} · ${gbWords(ram.availableMB)} FREE${ram.swapUsedMB ? ` · ${gbWords(ram.swapUsedMB)} IN SWAP` : ''}` : 'NO READING'}</b></h4>
          <Sheet label="memory holders" rows={ram?.holders ?? []} rowKey={(h) => `${h.label}:${h.pids[0]}`}
            columns={[nameColumn,
              { head: 'HOLDS', cell: (h) => gbWords(h.ramMB), sort: (h) => h.ramMB },
              { head: 'SWAPPED', cell: (h) => (h.swapMB > 64 ? gbWords(h.swapMB) : null), sort: (h) => h.swapMB, tone: (h) => (h.swapMB > 1024 ? 'alert' : null) },
              { head: 'PARTS', cell: (h) => h.pids.length, title: () => 'How many processes this holder is made of' }]}
            empty={<p className="hold-note">{ram?.holdersWhy || 'No holder could be read.'}</p>} />
        </section>
        <section className="hold-col" aria-label="processor">
          <h4 className="hold-h label-data">PROCESSOR <b>{cpu ? `${cpu.loadPct}% BUSY · ${cpu.cores.length} CORES${Number.isFinite(cpu.load1) ? ` · LOAD ${cpu.load1}` : ''}` : 'NO READING'}</b></h4>
          <ol className="hold-cores" aria-label="each core's load">
            {(cpu?.cores ?? []).map((c) => (
              <li key={c.core} className={`hold-core is-${coreStep(c.loadPct)}`} title={`Core ${c.core}: ${c.loadPct}% busy${c.holder ? `, mostly ${c.holder}` : ''}`}>
                <i style={{ height: `${Math.max(4, c.loadPct)}%` }} aria-hidden="true" />
                <span className="hold-core-n">{c.core}</span>
              </li>
            ))}
          </ol>
          <Sheet label="processor holders" rows={cpu?.holders ?? []} rowKey={(h) => `${h.label}:${h.pids[0]}`}
            columns={[nameColumn,
              { head: 'USES', cell: (h) => `${h.cpu}%`, sort: (h) => h.cpu, title: () => 'Of one core: 200% is two cores full' },
              { head: 'ON CORES', cell: (h) => (h.cores.length ? h.cores.join(' ') : null), sortable: false }]}
            empty={<p className="hold-note">{cpu?.holdersWhy || 'Nothing is using a whole percent of a core.'}</p>} />
        </section>
      </div>
    </Panel>
  );
};

/** Pure view of the image engine's lens. `act` runs UNLOAD / STOP; `acting` names the one in flight. */
export const EngineView = ({ lens, act, acting, said, span = 12 }) => {
  const view = engineView(lens);
  if (lens === undefined) return <Panel title="IMAGE ENGINE" span={span}><p className="sub-empty-row label-data">READING…</p></Panel>;
  if (!view) return <Panel title="IMAGE ENGINE" span={span}><p className="hud-down label-data">UNAVAILABLE — the platform did not answer</p></Panel>;
  return (
    <Panel title="IMAGE ENGINE" aside={<span className={view.tone ? `is-${view.tone}` : undefined}>{view.state}</span>} span={span} className="hold"
      tools={(
        <span className="hold-tools">
          <button type="button" className="sec-scan label-data" disabled={!view.canUnload || Boolean(acting)} title="Drop its loaded models and give their card memory back. The engine stays up." onClick={() => act('unload')}>{acting === 'unload' ? 'UNLOADING…' : 'UNLOAD MODELS'}</button>
          <button type="button" className="sec-scan label-data" disabled={!view.canStop || Boolean(acting)} title="End the engine and return everything it holds. It starts again on the next render." onClick={() => act('stop')}>{acting === 'stop' ? 'STOPPING…' : 'STOP ENGINE'}</button>
        </span>
      )}>
      {view.facts.length ? (
        <dl className="hold-facts">
          {view.facts.map((f) => <div key={f.k}><dt className="label-data">{f.k}</dt><dd>{f.v}</dd></div>)}
        </dl>
      ) : null}
      {said ? <p className="hold-note" role="status">{said}</p> : null}
      {view.loadedTitle ? <h4 className="hold-h label-data">{view.loadedTitle}</h4> : null}
      {view.models.length ? (
        <Sheet label="loaded models" rows={view.models} rowKey={(m) => m.name}
          columns={[
            { head: 'MODEL', cell: (m) => m.name },
            { head: 'KIND', cell: (m) => m.role },
            { head: 'SIZE', cell: (m) => m.size },
            { head: 'FILE', cell: (m) => m.file, exact: true },
            { head: 'LOADED', cell: (m) => m.at },
          ]} />
      ) : null}
      {view.models.length ? <p className="hold-note">Read from the engine&apos;s own recent log: it has no call that lists what it has loaded. Each file is matched to its model by kind.</p> : null}
    </Panel>
  );
};

// impure — the two reads, and the two acts on the engine.
export const HoldersPanels = () => {
  const [map, setMap] = useState(undefined);
  const [lens, setLens] = useState(undefined);
  const [acting, setActing] = useState(null);
  const [said, setSaid] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async () => {
    const [m, l] = await Promise.all([loadHolders(), loadImageEngine()]);
    if (!alive.current) return;
    setMap(m);
    setLens(l);
  }, []);
  const watch = useVisibleInterval(refresh, POLL_MS);
  const act = async (what) => {
    setActing(what);
    setSaid('');
    try {
      const before = lens?.memory?.modelsOnCardMB;
      await (what === 'unload' ? freeForge() : stopForge());
      // The engine drops its models a moment after it accepts; read it again once that has happened.
      await new Promise((resolve) => { setTimeout(resolve, what === 'unload' ? 3500 : 500); });
      const after = await loadImageEngine();
      if (!alive.current) return;
      setLens(after);
      setSaid(what === 'stop' ? 'Stopped. Everything it held is returned.'
        : `Unload asked for: its models held ${gbWords(before)} and now hold ${gbWords(after?.memory?.modelsOnCardMB)}.`);
      refresh();
    } catch (error) {
      if (alive.current) setSaid(`Not done: ${error?.message || 'the platform refused'}`);
    } finally {
      if (alive.current) setActing(null);
    }
  };
  return (
    <div className="hold-wrap sub-span-12" ref={watch}>
      <HoldersView map={map} />
      <EngineView lens={lens} act={act} acting={acting} said={said} />
    </div>
  );
};
