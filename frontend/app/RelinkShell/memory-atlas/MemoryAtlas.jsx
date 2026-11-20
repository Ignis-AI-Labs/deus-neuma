// MemoryAtlas — the CONTEXT MAP's MEMORY view: everything a being has kept,
// laid out so it can be found. A rail of ways in (topics, people, months,
// kinds), a search for words, the memories those leave as a plain table or a
// drawn map or a space to move through, and a reader that opens one memory in full with the memories
// nearest to it (design-language.md § JŌHŌ SEKKEI, § SHEET, § SURFACES).
//
// It replaced the FIELD: a ring of spirals with every link drawn over it,
// topics named by four words in alphabetical order, and a memory's record
// reduced to "DEGREE · BETWEENNESS" (Design note, 2026-11-20: […]).
//
// MemoryAtlasView is pure over its props; MemoryAtlas below it does the reads.

import { useEffect, useMemo, useState } from 'react';
import './MemoryAtlas.css';
import { useActiveCompanion } from '../consciousness-context.js';
import { useSettled } from '../use-settled.js';
import { EmptyState } from '../empty-state.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { formatCount } from '../../../utils/format.js';
import { loadAtlas, openAtlasMemory, searchAtlas } from './atlas-client.js';
import {
  NO_FILTERS, backOnTrail, dayWords, facetCounts, filterChips, kindWords, openOnTrail, shownMemories, stateWords,
  toggleFilter, topicWords,
} from './atlas-view.js';
import { AtlasRail } from './AtlasRail.jsx';
import { AtlasReader } from './AtlasReader.jsx';
import { AtlasMap } from './AtlasMap.jsx';
import { AtlasSpace } from './AtlasSpace.jsx';

const Refresh = ({ onRefresh }) => (
  <button type="button" className="atlas-btn label-data" onClick={onRefresh}>REFRESH</button>
);

// STANDING is a column only when a shown memory was set aside: a column that says ACTIVE on every row says nothing.
const columnsFor = (atlas, filters, openedId, onOpen, anyAside) => [
  {
    head: 'MEMORY', wrap: true, sortable: false,
    cell: (m) => (
      <button type="button" className="atlas-row-open" aria-current={m.id === openedId ? 'true' : undefined} onClick={() => onOpen(m.id)}>
        {m.line || '(no words kept)'}
      </button>
    ),
  },
  { head: 'WHEN', cell: (m) => dayWords(m.at), sort: (m) => { const t = Date.parse(m.at || ''); return Number.isNaN(t) ? null : t; } },
  { head: 'KIND', cell: (m) => kindWords(m.kind), tone: (m) => (m.state === 'active' ? null : 'dim') },
  ...(Number.isInteger(filters.topic) ? [] : [{ head: 'TOPIC', cell: (m) => (m.topic >= 0 ? topicWords(atlas, m.topic) : '—') }]),
  ...(anyAside ? [{ head: 'STANDING', cell: (m) => stateWords(m.state), tone: (m) => (m.state === 'active' ? null : 'alert') }] : []),
  { head: 'NEAR', cell: (m) => m.links, title: () => 'How many other memories lie near this one' },
];

/**
 * Pure view. atlas: undefined = being read · {ok:false, status} = the read failed · {ok:true, data}.
 * found: null = no search · undefined = searching · {ok:false} = the search failed · {ok:true, ids}.
 */
export const MemoryAtlasView = ({
  atlas: read, filters, query, found, mode, opened, openedId, canGoBack,
  onQuery, onToggle, onClear, onMode, onOpen, onBack, onClose, onRefresh,
}) => {
  const atlas = read?.ok ? read.data : null;
  const ids = found?.ok ? found.ids : null;
  const shown = useMemo(() => (atlas ? shownMemories(atlas, filters, ids) : []), [atlas, filters, ids]);
  const counts = useMemo(() => (atlas ? facetCounts(atlas, filters, ids) : null), [atlas, filters, ids]);
  const lit = useMemo(() => (atlas && shown.length !== atlas.memories.length ? new Set(shown.map((m) => m.id)) : null), [atlas, shown]);

  if (read === undefined) return <EmptyState title="READING THE MEMORY…" />;
  if (!read.ok) {
    return (
      <EmptyState title={`THE MEMORY COULD NOT BE READ${Number.isFinite(read.status) ? ` — HTTP ${read.status}` : ''}`} tone="error">
        <small>Nothing is drawn from a failed read. REFRESH asks the platform again.</small>
        <Refresh onRefresh={onRefresh} />
      </EmptyState>
    );
  }
  const { totals } = atlas;
  if (totals.memories === 0) {
    return (
      <EmptyState title="NO MEMORIES YET">
        <small>A memory forms when a conversation matters enough to keep, or when the being writes one down itself.</small>
        <Refresh onRefresh={onRefresh} />
      </EmptyState>
    );
  }
  const chips = filterChips(atlas, filters, found === null ? '' : query.trim());
  const near = openedId && opened?.ok ? opened.data.near : []; // a closed memory leaves no threads behind
  return (
    <div className={`atlas${openedId ? ' has-open' : ''}`}>
      <header className="atlas-head">
        <p className="atlas-sum label-data">
          <b>{formatCount(totals.memories)}</b> MEMORIES
          <span>·</span><b>{formatCount(totals.topics)}</b> TOPICS
          {totals.from ? <><span>·</span>{dayWords(totals.from)} → {dayWords(totals.to)}</> : null}
          {totals.setAside ? <><span>·</span>{formatCount(totals.setAside)} SET ASIDE</> : null}
          {totals.sortedNewest ? <><span>·</span>ONLY THE NEWEST {formatCount(totals.sortedNewest)} ARE SORTED INTO TOPICS</> : null}
        </p>
        <div className="atlas-tools">
          <input type="search" className="atlas-search" value={query} placeholder="Find words in this memory"
            aria-label="Find words in this memory" onChange={(e) => onQuery(e.target.value)} />
          <span className="atlas-seg" role="group" aria-label="standing">
            {[[null, 'ALL'], ['active', 'ACTIVE'], ['set-aside', 'SET ASIDE']].map(([value, words]) => (
              <button key={words} type="button" className={`atlas-btn label-data${filters.state === value ? ' is-on' : ''}`}
                aria-pressed={filters.state === value} onClick={() => onToggle('state', value)}>{words}</button>
            ))}
          </span>
          <span className="atlas-seg" role="group" aria-label="how the memories are shown">
            {[['list', 'LIST'], ['map', 'MAP'], ['space', 'SPACE']].map(([value, words]) => (
              <button key={value} type="button" className={`atlas-btn label-data${mode === value ? ' is-on' : ''}`}
                aria-pressed={mode === value} onClick={() => onMode(value)}>{words}</button>
            ))}
          </span>
          <Refresh onRefresh={onRefresh} />
        </div>
        <p className="atlas-chips label-data" aria-live="polite">
          <span className="atlas-shown"><b>{formatCount(shown.length)}</b> OF {formatCount(totals.memories)} SHOWN</span>
          {found === undefined ? <span>SEARCHING…</span> : null}
          {found && !found.ok ? <span className="is-alert">THE SEARCH FAILED — THE LIST IS NOT NARROWED BY IT</span> : null}
          {chips.map((c) => (
            <button key={c.key} type="button" className="atlas-chip" title="Lift this" onClick={() => (c.key === 'query' ? onQuery('') : onToggle(c.key, filters[c.key]))}>
              {c.label} <b>{c.words}</b> <span aria-hidden="true">✕</span>
            </button>
          ))}
          {chips.length > 1 ? <button type="button" className="atlas-chip is-clear" onClick={onClear}>CLEAR ALL</button> : null}
        </p>
      </header>
      <div className="atlas-body">
        <AtlasRail atlas={atlas} filters={filters} counts={counts} onToggle={onToggle} />
        <section className="atlas-main" aria-label="the memories shown">
          {mode === 'space' ? (
            <AtlasSpace atlas={atlas} lit={lit} openedId={openedId} near={near} filters={filters} onOpen={onOpen} onToggle={onToggle} />
          ) : mode === 'map' ? (
            <AtlasMap atlas={atlas} lit={lit} openedId={openedId} near={near} filters={filters} onOpen={onOpen} onToggle={onToggle} />
          ) : (
            <Sheet label="memories" rows={shown} rowKey={(m) => m.id} columns={columnsFor(atlas, filters, openedId, onOpen, shown.some((m) => m.state !== 'active'))}
              rowAttrs={(m) => (m.id === openedId ? { 'data-atlas-open': '' } : {})}
              empty={<EmptyState title="NO MEMORY MATCHES"><small>Lift a choice above, or search for fewer words.</small></EmptyState>} />
          )}
        </section>
        <AtlasReader atlas={atlas} opened={openedId ? opened : null} canGoBack={canGoBack}
          onBack={onBack} onClose={onClose} onOpen={onOpen} onToggle={onToggle} />
      </div>
    </div>
  );
};

// impure — the reads: the atlas once per being (and on REFRESH), a search as
// the words settle, one memory when it is opened.
export const MemoryAtlas = () => {
  const neumaId = useActiveCompanion()?.neumaId || null;
  const [atlas, setAtlas] = useState(undefined);
  const [readSeq, setReadSeq] = useState(0);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [mode, setMode] = useState('list');
  const [trail, setTrail] = useState([]);
  const [opened, setOpened] = useState(undefined);
  const openedId = trail[trail.length - 1] ?? null;

  // A new being is a new memory: every choice made on the last one is dropped.
  useEffect(() => { setFilters(NO_FILTERS); setQuery(''); setFound(null); setTrail([]); }, [neumaId]);

  useSettled((settled) => {
    setAtlas(undefined);
    loadAtlas(neumaId).then((r) => { if (!settled()) setAtlas(r); });
  }, [neumaId, readSeq]);

  useSettled((settled) => {
    const words = query.trim();
    if (!words) { setFound(null); return undefined; }
    setFound(undefined);
    const timer = setTimeout(() => {
      searchAtlas(neumaId, words).then((r) => { if (!settled()) setFound(r.ok ? { ok: true, ids: r.data.ids } : r); });
    }, 250);
    return () => clearTimeout(timer);
  }, [neumaId, query, readSeq]);

  useSettled((settled) => {
    if (!openedId) return;
    setOpened(undefined);
    openAtlasMemory(neumaId, openedId).then((r) => { if (!settled()) setOpened(r); });
  }, [neumaId, openedId, readSeq]);

  return (
    <MemoryAtlasView
      atlas={atlas} filters={filters} query={query} found={found} mode={mode}
      opened={opened} openedId={openedId} canGoBack={trail.length > 1}
      onQuery={setQuery}
      onToggle={(key, value) => setFilters((f) => toggleFilter(f, key, value))}
      onClear={() => { setFilters(NO_FILTERS); setQuery(''); }}
      onMode={setMode}
      onOpen={(id) => setTrail((t) => openOnTrail(t, id))}
      onBack={() => setTrail(backOnTrail)}
      onClose={() => setTrail([])}
      onRefresh={() => setReadSeq((s) => s + 1)}
    />
  );
};
