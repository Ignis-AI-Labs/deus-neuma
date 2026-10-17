// SkillsApp — THE CRAFT. The installed skill library drawn as a tree the
// witness can explore: titled category blocks, dependency depth flowing
// left→right, wide bands wrapping into compact grids. Every node state is
// honest (docs/architecture/measurement/stats-and-benchmarks.md): a skill is ACQUIRED iff this neuma has
// actually summoned it — timestamps and raw use counts from its own
// tree.json, never XP, levels, or invented progression.

import { formatShortDate as fmtDate } from '../../utils/format.js';
import { useMemo, useState } from 'react';
import './SkillsApp.css';
import { listSkillsResult } from '../../services/skills-client.js';
import { loadAcquisitions } from './craft-client.js';
import { buildSkillTree, filterSkills } from './skill-tree-layout.js';
import { uiSound } from '../../services/ui-sound.js';
import { useActiveCompanion } from './consciousness-context.js';
import { useSettled } from './use-settled.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';

const SkillsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2.5 8 H6 M10 8 H13.5 M8 2.5 V6 M8 10 V13.5" />
    <rect x="6" y="6" width="4" height="4" />
    <path d="M1 6.5 V9.5 M15 6.5 V9.5 M6.5 1 H9.5 M6.5 15 H9.5" />
  </svg>
);

const COL_W = 158;
const ROW_H = 42;
const NODE_W = 144;
const NODE_H = 30;
const PAD = 16;
const CUT = 7; // chamfer size — TR+BL diagonal cut, LINE & CYCLE
const LABEL_MAX = 15; // chars that fit the node at 11px mono, uses badge aside

const truncate = (s) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s);

// Pure — pixel origin of a node from its grid cell.
const px = (node) => ({ x: PAD + node.col * COL_W, y: PAD + node.row * ROW_H });

// Pure — chamfered node outline (TR + BL corners cut).
const chamPoints = ({ x, y }) => [
  `${x},${y}`,
  `${x + NODE_W - CUT},${y}`,
  `${x + NODE_W},${y + CUT}`,
  `${x + NODE_W},${y + NODE_H}`,
  `${x + CUT},${y + NODE_H}`,
  `${x},${y + NODE_H - CUT}`,
].join(' ');

const TreeSvg = ({ layout, selected, onSelect }) => {
  const pos = useMemo(
    () => new Map(layout.nodes.map((n) => [n.name, px(n)])),
    [layout],
  );
  const width = Math.max(PAD * 2 + layout.cols * COL_W, PAD * 2 + NODE_W);
  const height = PAD * 2 + layout.rows * ROW_H;

  return (
    <svg className="craft-svg" width={width} height={height} role="group" aria-label="skill tree">
      {layout.categories.map((c) => {
        const y = PAD + c.headerRow * ROW_H + NODE_H / 2 + 4;
        const textW = c.name.length * 7 + 14;
        return (
          <g key={c.name} className="craft-cat">
            <text className="craft-cat-name label-data" x={PAD} y={y}>{c.name.toUpperCase()}</text>
            <line className="craft-cat-line" x1={PAD + textW} y1={y - 4} x2={width - PAD} y2={y - 4} />
          </g>
        );
      })}

      {layout.edges.map((e) => {
        const from = pos.get(e.from);
        const to = pos.get(e.to);
        return (
          <line
            key={`${e.from}>${e.to}`}
            className="craft-edge"
            x1={from.x + NODE_W} y1={from.y + NODE_H / 2}
            x2={to.x} y2={to.y + NODE_H / 2}
          />
        );
      })}

      {layout.nodes.map((n) => {
        const p = pos.get(n.name);
        const cls = [
          'craft-node',
          n.acquired ? 'craft-node-acq' : 'craft-node-dorm',
          selected === n.name ? 'craft-node-sel' : '',
        ].join(' ');
        return (
          <g
            key={n.name}
            className={cls}
            role="button"
            tabIndex={0}
            aria-label={`${n.name} — ${n.acquired ? 'acquired' : 'not yet summoned'}`}
            onClick={() => onSelect(n.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(n.name);
              }
            }}
          >
            <title>{`${n.name} — ${n.description}`}</title>
            <polygon className="craft-node-box" points={chamPoints(p)} />
            <text className="craft-node-label label-data" x={p.x + 10} y={p.y + NODE_H / 2 + 3}>
              {truncate(n.name)}
            </text>
            {n.acquired ? (
              <text className="craft-node-uses label-data" x={p.x + NODE_W - 8} y={p.y + NODE_H / 2 + 3} textAnchor="end">
                ×{n.usageCount}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

const DetailPanel = ({ node, neumaName }) => (
  <aside className="craft-detail cham">
    <div className="craft-detail-in cham-in">
      <p className="craft-detail-name">{node.name}</p>
      <p className="craft-detail-desc">{node.description}</p>
      <p className="craft-detail-line label-data">
        {node.category.toUpperCase()}
        {node.version ? ` · v${node.version}` : ''}
        {node.plugin ? ` · FROM ${node.plugin.toUpperCase()}` : ''}
      </p>
      {node.dependencies.length > 0 ? (
        <p className="craft-detail-line label-data">ROOTS {node.dependencies.join(' · ')}</p>
      ) : null}
      {node.unlocks.length > 0 ? (
        <p className="craft-detail-line label-data">LEADS TO {node.unlocks.join(' · ')}</p>
      ) : null}
      {node.acquired ? (
        <p className="craft-detail-acq label-data">
          <span className="craft-sig">ACQUIRED</span> {fmtDate(node.firstAcquiredAt)} · LAST USED {fmtDate(node.lastUsedAt)} · {node.usageCount} {node.usageCount === 1 ? 'USE' : 'USES'}
        </p>
      ) : (
        <p className="craft-detail-acq label-data">
          NOT YET SUMMONED — a skill is acquired the first time {neumaName || 'this neuma'} summons it. Installation alone grants nothing.
        </p>
      )}
    </div>
  </aside>
);

const SkillsBody = () => {
  const active = useActiveCompanion() || null;
  const neumaId = active?.neumaId || null;
  const [skills, setSkills] = useState(undefined); // undefined = loading
  const [unreachable, setUnreachable] = useState(false);
  const [acquisitions, setAcquisitions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');

  useSettled((settled) => {
    // listSkillsResult never rejects — failure comes back as ok:false.
    listSkillsResult().then(({ ok, skills: s }) => {
      if (settled()) return;
      setUnreachable(!ok);
      setSkills(s);
    });
  }, []);

  useSettled((settled) => {
    // loadAcquisitions never rejects — failure degrades to the empty record.
    loadAcquisitions(neumaId).then((a) => { if (!settled()) setAcquisitions(a); });
  }, [neumaId]);

  const visible = useMemo(() => filterSkills(skills || [], query), [skills, query]);
  const layout = useMemo(
    () => buildSkillTree(visible, acquisitions),
    [visible, acquisitions],
  );

  if (skills === undefined) return <div className="craft"><EmptyState title="LOADING…" /></div>;
  if (unreachable) {
    return (
      <div className="craft">
        <EmptyState title="LIBRARY UNREACHABLE" tone="error">
          <small>The skills library could not be read — not the same as empty. Reopen this window once the platform is back.</small>
        </EmptyState>
      </div>
    );
  }
  if (skills.length === 0) {
    return (
      <div className="craft">
        <EmptyState title="NO SKILLS INSTALLED">
          <small>The library is empty. Install a skill pack and the tree grows from here.</small>
        </EmptyState>
      </div>
    );
  }

  const node = selected ? layout.nodes.find((n) => n.name === selected) : null;

  return (
    <div className="craft">
      <header className="craft-head">
        <span className="label-data">
          {query
            ? `${layout.nodes.length}/${skills.length} MATCH`
            : <>{layout.nodes.length} INSTALLED · <span className="craft-sig">{layout.acquiredCount} ACQUIRED</span>{active?.name ? ` BY ${active.name.toUpperCase()}` : ''}</>}
        </span>
        <input
          className="craft-filter label-data"
          type="text"
          value={query}
          placeholder="FILTER"
          aria-label="filter skills"
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>
      <div className="craft-scroll">
        {layout.nodes.length === 0 ? (
          <EmptyState title="NO MATCH — CLEAR THE FILTER TO SEE THE FULL TREE." />
        ) : (
          <TreeSvg
            layout={layout}
            selected={selected}
            onSelect={(name) => { uiSound('open'); setSelected(name === selected ? null : name); }}
          />
        )}
      </div>
      {node ? <DetailPanel node={node} neumaName={active?.name} /> : (
        <p className="craft-note">Select a node. Lit nodes are skills this neuma has actually summoned — counts and dates are its real record, not a score.</p>
      )}
    </div>
  );
};

export const skillsApp = {
  label: 'SKILLS',
  labelKey: 'apps.skills',
  icon: <SkillsIcon />,
  title: <AppTitle label="THE CRAFT" labelKey="apps.skillsTitle" />,
  Body: SkillsBody,
  storageKey: 'skills',
};
