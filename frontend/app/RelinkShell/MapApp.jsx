// MapApp — REPO MAP. Any repository's architecture as an immersive readout.
// It follows this window's working FOCUS (the folder in focus) — point it at
// any folder and it maps what's there: void ground,
// SIGNAL-cyan live wiring, ALERT-red severed links. Two wiring
// lenses (SYSTEMS = functional subsystems + their dependencies; CHANNELS =
// message lines producer→channel→consumer) plus ROUTES / FUNCTIONS / ANOMALIES.
// Served by /api/v1/map. States are honest — the map is never invented.

import { useContext, useEffect, useState } from 'react';
import './MapApp.css';
import { loadArchitectureMap } from './map-client.js';
import { FolderOpenFlow } from './FolderOpenFlow.jsx';
import { AppTitle } from './app-title.jsx';
import { FocusContext } from './use-desk-focus.js';
import { focusFolderPath } from './desk-focus.js';
import {
  groupRoutesByPrefix, isUnpaired, fileFunctionIndex,
  systemFocus, wireLayout, baseName, dirOf, groupExternalByKind, groupStorageByKind,
  orderEnvVars, looksSecret, splitDuplicates, looksGuard,
} from './map-view.js';

// Human labels for egress kinds — what each outbound connection actually is.
const EGRESS_LABEL = {
  http: 'HTTP · outbound requests',
  rpc: 'RPC · blockchain providers',
  'ws-client': 'WS CLIENT · outbound sockets',
  mcp: 'MCP · tool-server transports',
};
const STORAGE_LABEL = { read: 'READ · reads from disk', write: 'WRITE · writes to disk' };

const MapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="3.5" cy="3.5" r="1.6" /><circle cx="12.5" cy="3.5" r="1.6" /><circle cx="8" cy="12.5" r="1.6" />
    <path d="M4.6 4.6 7 11 M11.4 4.6 9 11 M5 3.5 H11" />
  </svg>
);

// The interactive wiring board: pure layout → SVG, hover traces one node's wires.
const WireBoard = ({ left, mid, right, edges }) => {
  const [hot, setHot] = useState(null);
  const { width, height, nodes, paths } = wireLayout(left, mid, right, edges);
  if (!nodes.length) return <p className="elo-empty">Nothing wired here.</p>;
  const related = new Set(hot ? [hot] : []);
  if (hot) for (const p of paths) if (p.a === hot || p.b === hot) { related.add(p.a); related.add(p.b); }
  return (
    <div className="elo-scroll">
      <svg className={`elo-wire${hot ? ' is-dim' : ''}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img">
        {paths.map((p, i) => (
          <path key={i} className={`elo-edge${p.sev ? ' is-sev' : ''}${hot && (p.a === hot || p.b === hot) ? ' is-on' : ''}`} d={p.d} />
        ))}
        {nodes.map((n) => (
          <g key={`${n.side}:${n.id}`} className={`elo-node ${n.cls || ''}${related.has(n.id) ? ' is-on' : ''}`}
            onMouseEnter={() => setHot(n.id)} onMouseLeave={() => setHot(null)}>
            <title>{n.title || n.id}</title>
            <rect x={n.x} y={n.y - 13} width={n.w} height={26} rx="1" />
            <text x={n.side === 'M' ? n.x + n.w / 2 : n.side === 'L' ? n.x + 10 : n.x + n.w - 10}
              y={n.sub ? n.y - 1 : n.y + 3} textAnchor={n.side === 'M' ? 'middle' : n.side === 'L' ? 'start' : 'end'}>{n.label}</text>
            {n.sub ? (
              <text className="sub" x={n.side === 'L' ? n.x + 10 : n.x + n.w - 10} y={n.y + 9}
                textAnchor={n.side === 'L' ? 'start' : 'end'}>{n.sub}</text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
};

const Legend = () => (
  <div className="elo-legend">
    <span className="elo-legend-t">LEGEND</span>
    <span className="elo-lg"><i className="sw live" />live link — both ends wired</span>
    <span className="elo-lg"><i className="sw sev" />severed — one end missing (verify: break or dynamic)</span>
    <span className="elo-lg"><i className="sw hub" />focus node · peers feed in (left) / out (right)</span>
    <span className="elo-lg">hover a node to trace only its wiring</span>
  </div>
);

const SystemsView = ({ graph, sel }) => {
  const focus = systemFocus(graph.subsystemEdges, sel);
  const s = graph.subsystems.find((x) => x.id === sel) || { files: 0, functions: 0 };
  const left = focus.dependents.map((d) => ({ id: d.id, label: baseName(d.id) || d.id, sub: (d.id).toUpperCase(), title: `${d.id} → depends on this ×${d.count}` }));
  const right = focus.dependencies.map((d) => ({ id: d.id, label: baseName(d.id) || d.id, sub: (d.id).toUpperCase(), title: `${sel} → ${d.id} ×${d.count}` }));
  const mid = [{ id: sel, label: baseName(sel) || sel, sub: `${s.files}F · ${s.functions}FN`, cls: 'hub', title: sel }];
  const edges = [
    ...focus.dependents.map((d) => ({ side: 'L', a: d.id, b: sel })),
    ...focus.dependencies.map((d) => ({ side: 'M', a: sel, b: d.id })),
  ];
  return <WireBoard left={left} mid={mid} right={right} edges={edges} />;
};

const ChannelsView = ({ graph, ns }) => {
  const chans = graph.channels.filter((c) => c.namespace === ns);
  const prods = [...new Set(chans.flatMap((c) => c.producers))].sort();
  const cons = [...new Set(chans.flatMap((c) => c.consumers))].sort();
  const left = prods.map((f) => ({ id: `P:${f}`, label: baseName(f), sub: (dirOf(f) || '·').toUpperCase(), title: f }));
  const right = cons.map((f) => ({ id: `C:${f}`, label: baseName(f), sub: (dirOf(f) || '·').toUpperCase(), title: f }));
  const mid = chans.map((c) => ({ id: c.name, label: c.name.slice(c.name.indexOf(':') + 1), cls: `chan${isUnpaired(c) ? ' sev' : ''}`, title: `${c.name}${isUnpaired(c) ? ' «SEVERED»' : ''} · ${c.producers.length}▸ ${c.consumers.length}◂` }));
  const edges = [];
  for (const c of chans) {
    const sev = isUnpaired(c);
    c.producers.forEach((f) => edges.push({ side: 'L', a: `P:${f}`, b: c.name, sev }));
    c.consumers.forEach((f) => edges.push({ side: 'M', a: c.name, b: `C:${f}`, sev }));
  }
  return <WireBoard left={left} mid={mid} right={right} edges={edges} />;
};

const RoutesView = ({ graph }) => {
  const groups = groupRoutesByPrefix(graph.routes);
  if (!groups.length) return <p className="elo-empty">No routes found.</p>;
  return (
    <div className="elo-list">
      {groups.map((g) => (
        <section key={g.prefix} className="elo-grp">
          <h4 className="elo-grp-h">{g.prefix}<span className="elo-c">{g.routes.length}</span></h4>
          {g.routes.map((r, i) => (
            <div key={`${r.method}${r.path}${i}`} className="elo-row">
              <span className="elo-m">{r.method}</span><span className="elo-path">{r.path}</span>
              <span className="elo-at">{baseName(r.file)}:{r.line}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
};

const FunctionsView = ({ graph }) => {
  const index = fileFunctionIndex(graph.functions, graph.callEdges);
  if (!index.length) return <p className="elo-empty">No functions found.</p>;
  return (
    <div className="elo-list">
      {index.map((f) => (
        <div key={f.file} className="elo-fn">
          <span className="elo-fn-n" title={f.file}>{baseName(f.file)}</span>
          <span className="elo-fn-tags">
            {f.kinds.class ? <span className="elo-tag" title="classes defined here">{f.kinds.class} cls</span> : null}
            {f.kinds.function ? <span className="elo-tag" title="functions defined here">{f.kinds.function} fn</span> : null}
            {f.kinds.method ? <span className="elo-tag" title="methods defined here">{f.kinds.method} m</span> : null}
            {f.out.length ? <span className="elo-tag" title="files this one calls into">▸{f.out.length}</span> : null}
            {f.in.length ? <span className="elo-tag" title="files that call this one">◂{f.in.length}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
};

const ExternalView = ({ graph }) => {
  const groups = groupExternalByKind(graph.external || []);
  if (!groups.length) return <p className="elo-empty">No outbound connections detected.</p>;
  return (
    <div className="elo-list">
      {groups.map((g) => (
        <section key={g.kind} className="elo-grp">
          <h4 className="elo-grp-h">
            {EGRESS_LABEL[g.kind] || g.kind}
            <span className="elo-c">{g.files} file{g.files === 1 ? '' : 's'} · {g.sites} site{g.sites === 1 ? '' : 's'}</span>
          </h4>
          {g.entries.map((e) => (
            <div key={e.file} className="elo-row">
              <span className="elo-path" title={e.file}>{baseName(e.file)}</span>
              {e.hosts.length
                ? <span className="elo-ext-hosts">{e.hosts.join(', ')}</span>
                : <span className="elo-ext-dyn" title="target resolved at runtime — not a literal URL">dynamic</span>}
              <span className="elo-at">×{e.count}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
};

const StorageView = ({ graph }) => {
  const groups = groupStorageByKind(graph.storage || []);
  if (!groups.length) return <p className="elo-empty">No filesystem access detected.</p>;
  return (
    <div className="elo-list">
      {groups.map((g) => (
        <section key={g.kind} className="elo-grp">
          <h4 className="elo-grp-h">
            {STORAGE_LABEL[g.kind] || g.kind}
            <span className="elo-c">{g.files} file{g.files === 1 ? '' : 's'} · {g.sites} site{g.sites === 1 ? '' : 's'}</span>
          </h4>
          {g.entries.map((e) => (
            <div key={e.file} className="elo-row">
              <span className="elo-path" title={e.file}>{baseName(e.file)}</span>
              <span className="elo-at">×{e.count}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
};

const EnvView = ({ graph }) => {
  const vars = orderEnvVars(graph.env || []);
  if (!vars.length) return <p className="elo-empty">No environment variables read.</p>;
  return (
    <div className="elo-list">
      {vars.map((e) => {
        const dyn = e.name === '(dynamic)';
        return (
          <div key={e.name} className="elo-row">
            <span className={`elo-env-n${dyn ? ' is-dyn' : ''}`}>
              {e.name}{!dyn && looksSecret(e.name) ? <span className="elo-env-secret" title="secret-shaped name — handle carefully">SECRET</span> : null}
            </span>
            <span className="elo-env-files" title={e.files.join('\n')}>{e.files.length} file{e.files.length === 1 ? '' : 's'}</span>
            <span className="elo-at">×{e.count}</span>
          </div>
        );
      })}
    </div>
  );
};

const MiddlewareView = ({ graph }) => {
  const mws = graph.middleware || [];
  if (!mws.length) return <p className="elo-empty">No middleware detected.</p>;
  return (
    <div className="elo-list">
      {mws.map((mw) => (
        <div key={mw.name} className="elo-row">
          <span className={`elo-mw-n${looksGuard(mw.name) ? ' is-guard' : ''}`}>{mw.name}</span>
          <span className="elo-mw-scope">{mw.scopes.join(' + ')}</span>
          <span className="elo-mw-files" title={mw.files.join('\n')}>{mw.files.length} file{mw.files.length === 1 ? '' : 's'}</span>
        </div>
      ))}
    </div>
  );
};

const PrimitivesView = ({ graph }) => {
  const { confirmed, candidates } = splitDuplicates(graph.duplicates || []);
  if (!confirmed.length && !candidates.length) return <p className="elo-empty">No duplicated functions. Clean.</p>;
  const FilesRow = ({ files }) => (
    <div className="elo-row">
      <span className="elo-dup-files" title={files.join('\n')}>{files.map(baseName).join(', ')}</span>
      <span className="elo-at">×{files.length}</span>
    </div>
  );
  return (
    <div className="elo-list">
      <section className="elo-grp elo-dup-exact">
        <h4 className="elo-grp-h">
          EXACT COPIES · consolidate<span className="elo-c">{confirmed.length}</span>
        </h4>
        {confirmed.length
          ? confirmed.map((d) => (
            <div key={d.name} className="elo-dup">
              <span className="elo-dup-n">{d.name}</span>
              {/* one row per distinct identical-body cluster — a name can have several */}
              {(d.clusters || []).map((files, i) => <FilesRow key={i} files={files} />)}
            </div>
          ))
          : <p className="elo-empty">None — no byte-identical duplicates.</p>}
      </section>
      <section className="elo-grp">
        <h4 className="elo-grp-h">
          SAME NAME · verify<span className="elo-c">{candidates.length}</span>
        </h4>
        {candidates.map((d) => (
          <div key={d.name} className="elo-dup">
            <span className="elo-dup-n">{d.name}</span>
            <FilesRow files={d.files} />
          </div>
        ))}
      </section>
    </div>
  );
};

const AnomaliesView = ({ graph }) => {
  if (!graph.anomalies.length) return <p className="elo-empty">Nothing flagged. Clean surface.</p>;
  return (
    <div className="elo-list">
      {graph.anomalies.map((a, i) => (
        <div key={`${a.kind}${a.label}${i}`} className={`elo-anom is-${a.severity}`}>
          <span className="elo-anom-k">{a.kind.replace(/-/g, ' ')}</span>
          <span className="elo-anom-l">{a.label}</span>
          <p className="elo-anom-d">{a.detail}</p>
        </div>
      ))}
    </div>
  );
};

const LENSES = [
  { id: 'systems', label: 'SYSTEMS' }, { id: 'channels', label: 'CHANNELS' },
  { id: 'routes', label: 'ROUTES' }, { id: 'functions', label: 'FUNCTIONS' },
  { id: 'external', label: 'EXTERNAL' }, { id: 'storage', label: 'STORAGE' },
  { id: 'env', label: 'ENV' }, { id: 'middleware', label: 'MIDDLEWARE' },
  { id: 'primitives', label: 'PRIMITIVES' }, { id: 'anomalies', label: 'ANOMALIES' },
];
const Stat = ({ n, label, flag }) => (
  <div className={`elo-stat${flag ? ' is-flag' : ''}`}><b>{Number.isFinite(n) ? n : '—'}</b><span>{label}</span></div>
);

const MapBody = () => {
  const [state, setState] = useState({ phase: 'loading' });
  const [lens, setLens] = useState('systems');
  const [ns, setNs] = useState(null);
  const [sys, setSys] = useState(null);
  const [picking, setPicking] = useState(false);
  const [openNote, setOpenNote] = useState('');
  // This window's focus decides what the map indexes: the folder in focus, or
  // with nothing in focus the NEUMA repo by default. Only a HINT — the server
  // re-validates the path against the opened roots (resolveFocusPath).
  const focus = useContext(FocusContext);
  const folder = focusFolderPath(focus?.focus ?? null);

  const load = () => {
    setState({ phase: 'loading' });
    loadArchitectureMap(folder).then((res) => {
      if (res.ok) setState({ phase: 'ready', project: res.project, graph: res.graph });
      else if (res.status === 404) setState({ phase: 'no-project' });
      else setState({ phase: 'error' });
    }).catch(() => setState({ phase: 'error' })); // a rejection must reach the retryable state, not strand on loading
  };
  // Re-index when this window's lens moves (a focus change is a new target).
  useEffect(load, [folder]);

  // A folder that landed as the working focus re-indexes immediately — the map
  // always shows the project the desk is actually in.
  const onFolderFlowDone = (opened, message) => {
    setPicking(false);
    setOpenNote(message || '');
    if (opened) load();
  };
  const folderFlow = <FolderOpenFlow open={picking} onDone={onFolderFlowDone} />;

  if (state.phase === 'loading') return <div className="elo-state">Indexing the project…</div>;
  if (state.phase === 'no-project') {
    return (
      <div className="elo-state">
        {folderFlow}
        <p className="elo-state-line">Nothing to map yet.</p>
        <button type="button" className="elo-open" onClick={() => setPicking(true)}>OPEN FOLDER…</button>
        <p className="elo-state-hint">Point the map at any folder or repository — it becomes this window's working focus.</p>
        {openNote ? <p className="elo-state-err label-data">{openNote}</p> : null}
      </div>
    );
  }
  if (state.phase === 'error') return <div className="elo-state">Couldn’t reach the index. <button type="button" className="elo-retry" onClick={load}>Retry</button></div>;

  const { project, graph } = state;
  const namespaces = [...new Set(graph.channels.map((c) => c.namespace))].sort();
  const systems = graph.subsystems.map((s) => s.id);
  const activeNs = ns && namespaces.includes(ns) ? ns : namespaces[0];
  const activeSys = sys && systems.includes(sys) ? sys : systems[0];
  const severed = graph.channels.filter(isUnpaired).length;

  return (
    <div className="elo">
      {folderFlow}
      <div className="elo-hazard" aria-hidden="true" />
      <header className="elo-head">
        <div className="elo-brand">
          <span className="elo-sys">NEUMA // ARCHITECTURE INDEX</span>
          <span className="elo-proj">{project?.name || 'project'}</span>
          {project?.default ? (
            <span className="elo-default label-data" title="Nothing in focus — showing the NEUMA repo by default. OPEN… to map another.">DEFAULT</span>
          ) : null}
          <button type="button" className="elo-open elo-open--head" onClick={() => setPicking(true)}
            title="Open a different folder or repository">OPEN…</button>
        </div>
        <div className="elo-stats">
          <Stat n={graph.meta.subsystemCount} label="systems" />
          <Stat n={graph.meta.routeCount} label="routes" />
          <Stat n={graph.meta.channelCount} label="channels" />
          <Stat n={graph.meta.functionCount} label="functions" />
          <Stat n={graph.meta.classCount} label="classes" />
          <Stat n={graph.meta.externalCount} label="egress" />
          <Stat n={graph.meta.storageCount} label="disk i/o" />
          <Stat n={graph.meta.envVarCount} label="env vars" />
          <Stat n={graph.meta.middlewareCount} label="middleware" />
          <Stat n={graph.meta.duplicateExactCount} label="dup copies" flag={graph.meta.duplicateExactCount > 0} />
          <Stat n={severed} label="severed" flag={severed > 0} />
        </div>
      </header>
      <div className="elo-ann">
        <span className="elo-ann-ok">«INDEX COMPLETE»</span>
        <span className="elo-ann-n">{graph.meta.scannedFiles} NODES</span>
        {severed > 0 ? <span className="elo-ann-sev">«{severed} LINK{severed === 1 ? '' : 'S'} TO VERIFY»</span> : null}
      </div>
      {openNote ? <p className="elo-state-err label-data">{openNote}</p> : null}

      <nav className="elo-lenses" aria-label="Map filters">
        {LENSES.map((l) => (
          <button key={l.id} type="button" aria-pressed={lens === l.id}
            className={`elo-lens${lens === l.id ? ' is-sel' : ''}`} onClick={() => setLens(l.id)}>{l.label}</button>
        ))}
      </nav>

      {lens === 'systems' || lens === 'channels' ? <Legend /> : null}

      {lens === 'systems' ? (
        <>
          <div className="elo-chips">
            {systems.map((id) => (
              <button key={id} type="button" aria-pressed={id === activeSys}
                className={`elo-chip${id === activeSys ? ' is-on' : ''}`} title={id} onClick={() => setSys(id)}>{baseName(id) || id}</button>
            ))}
          </div>
          <div className="elo-board"><SystemsView graph={graph} sel={activeSys} /></div>
        </>
      ) : null}

      {lens === 'channels' ? (
        <>
          <div className="elo-chips">
            {namespaces.map((n) => {
              const sv = graph.channels.filter((c) => c.namespace === n && isUnpaired(c)).length;
              return (
                <button key={n} type="button" aria-pressed={n === activeNs}
                  className={`elo-chip${n === activeNs ? ' is-on' : ''}`} onClick={() => setNs(n)}>
                  {n}{sv ? <span className="elo-chip-sev">{sv}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="elo-board"><ChannelsView graph={graph} ns={activeNs} /></div>
        </>
      ) : null}

      {lens === 'routes' ? <div className="elo-panel"><RoutesView graph={graph} /></div> : null}
      {lens === 'functions' ? <div className="elo-panel"><FunctionsView graph={graph} /></div> : null}
      {lens === 'external' ? <div className="elo-panel"><ExternalView graph={graph} /></div> : null}
      {lens === 'storage' ? <div className="elo-panel"><StorageView graph={graph} /></div> : null}
      {lens === 'env' ? <div className="elo-panel"><EnvView graph={graph} /></div> : null}
      {lens === 'middleware' ? <div className="elo-panel"><MiddlewareView graph={graph} /></div> : null}
      {lens === 'primitives' ? <div className="elo-panel"><PrimitivesView graph={graph} /></div> : null}
      {lens === 'anomalies' ? <div className="elo-panel"><AnomaliesView graph={graph} /></div> : null}
    </div>
  );
};

export const mapApp = {
  label: 'REPO MAP',
  labelKey: 'apps.map',
  icon: <MapIcon />,
  title: <AppTitle label="REPO MAP" labelKey="apps.map" />,
  Body: MapBody,
  storageKey: 'map',
};
