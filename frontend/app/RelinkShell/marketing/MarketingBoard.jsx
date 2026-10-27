// MarketingBoard — the BOARD tab of one MARKETING level (marketing-panel-plan.md
// §2.1, slices 2–3): the health strip first (marketing-health.js on SUBSTRATE's
// HealthStrip), then the level's panels on the 12-column grid, laid out from
// a plain list: the level's saved board (use-board.js), or the default one
// (marketing-board.js defaultBoard) until the operator changes it. Each
// panel's ⋯ (PanelTools.jsx) and the board's end (BoardEnd.jsx) are the
// operator's levers; every change saves the whole board. The picture first (JŌHŌ
// SEKKEI), plain to a stranger (CHOKKAN), every mark true (SHINKEI). Every
// count is a door: a cell narrows the posts, opens a tab, brings a panel into
// view or reads the platforms now; a grid or matrix cell narrows the posts,
// and the posts say what they show, with SHOW ALL beside it.
//
// The strip carries what used to be the WAITING ON YOU band (the ◆ YOU cell;
// the tray stays the desk-wide signal). Every read the board lays out from is
// the window's calm-gated one (use-marketing-overview.js); the strip's own
// cells (what waits, the mandate) change in place, never re-laying a panel.
//
// impure — the mandate's shared read and the level's board; the rest is rendering over the window's read.

import { useMemo, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { HealthStrip, revealPanel } from '../HealthStrip.jsx';
import { useMandate } from '../mandate/use-mandate.js';
import { gridOf, postRows, inScope, accountOf } from '../marketing-overview/overview-fold.js';
import { linkTotals, postFacts, campaignCard, angleMatrix } from '../marketing-overview/results-fold.js';
import { filterWords } from '../marketing-overview/overview-words.js';
import { marketingHealth } from './marketing-health.js';
import { defaultBoard } from './marketing-board.js';
import { levelKey, drawnBoard, editBoard, asStored, addableEntries, panelWords } from './board-edit.js';
import { accountMarkWords } from '../accounts/account-words.js';
import { useBoard } from './use-board.js';
import { BoardPanel } from './BoardPanels.jsx';
import { PanelTools } from './PanelTools.jsx';
import { BoardEnd } from './BoardEnd.jsx';
import '../marketing-overview/MarketingOverview.css';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {object} props
 * @param {object} props.read - useMarketingOverview's return
 * @param {?Set<string>} props.scope - the level's companies; null = the house
 * @param {?string} props.companyId - the level's company; null = the house
 * @param {object[]} props.tiles - the companies under this level (zoom-fold.js)
 * @param {object} props.filter - what a door narrowed the posts to
 * @param {(next: object) => void} props.onFilter
 * @param {{busy: boolean, run: () => Promise<void>}} props.reading - READ NOW (use-read-now.js)
 * @param {(campaignId: string) => void} props.onOpenCampaign
 * @param {(tab: string) => void} props.onTab
 * @param {(companyId: string) => void} props.onZoom
 * @param {(accountIds: string[]) => void} props.onLoose
 * @param {?object} props.calm - the window's calm gate (use-calm-gate.js): a board changed elsewhere waits on it
 */
export const MarketingBoard = ({ read, scope, companyId, tiles, filter, onFilter, reading, onOpenCampaign, onTab, onZoom, onLoose, calm }) => {
  const { data, errors, refresh, accounts, companies, waiting, locked } = read;
  const { view: mandateView, error: mandateError } = useMandate();
  const [all, setAll] = useState(false);
  // One clock per read, so the picture is the same until the next read.
  const now = useMemo(() => Date.now(), [data]);

  const view = useMemo(() => {
    if (!data) return null;
    const companyOfAccount = (id) => accounts.find((a) => a.id === id)?.companyId ?? null;
    const totals = linkTotals(data.links, data.results.links?.counts);
    const factsOf = (e) => postFacts(e, data.results, totals);
    const campaigns = data.campaigns.filter((c) => inScope(scope, c.companyId));
    const queue = data.queue.filter((e) => inScope(scope, companyOfAccount(accountOf(e))));
    return {
      factsOf,
      grid: gridOf({ companies, accounts, check: data.check, campaigns: data.campaigns, scope }),
      cards: campaigns.map((c) => campaignCard(c, { queue: data.queue, results: data.results, totals, now })),
      matrix: angleMatrix(campaigns, queue, factsOf),
      rows: postRows(data.queue, filter, { scope, companyOfAccount }),
      total: queue.filter((e) => e.kind !== 'reply').length,
    };
  }, [data, accounts, companies, scope, filter, now]);

  // The level's accounts (at the house every one, an account under no company too) and the names the panels say.
  const levelAccounts = useMemo(() => (accounts || []).filter((a) => scope === null || inScope(scope, a.companyId)), [accounts, scope]);
  const platforms = useMemo(() => [...new Set(levelAccounts.map((a) => a.channelId))], [levelAccounts]);
  const names = useMemo(() => ({
    // A platform's name without its aside ("X (Twitter)" is X): its mark beside it says the rest.
    platforms: Object.fromEntries((accounts || []).map((a) => [a.channelId, String(a.channelName || a.channelId).replace(/\s*\(.*\)\s*$/, '').toUpperCase()])),
    accounts: Object.fromEntries((accounts || []).map((a) => [a.id, accountMarkWords({ accountId: a.id }, accounts, companies).text])),
    companies: Object.fromEntries((companies || []).map((c) => [c.id, c.name])),
  }), [accounts, companies]);
  const choices = useMemo(() => ({ capability: data?.results?.capability || {}, platforms, names }), [data, platforms, names]);

  const cells = useMemo(() => (data ? marketingHealth({ data, errors, waiting, mandate: { view: mandateView, error: mandateError }, accounts, locked, scope, now }) : null),
    [data, errors, waiting, mandateView, mandateError, accounts, locked, scope, now]);
  const defaults = useMemo(() => (view ? defaultBoard({ companyId, tiles: tiles.length, campaignIds: view.cards.map((c) => c.id), platforms }) : []),
    [view, companyId, tiles.length, platforms]);
  const stored = useBoard({ level: levelKey(companyId), calm });
  const drawn = useMemo(() => drawnBoard({ saved: stored.saved, defaults, campaignIds: view ? view.cards.map((c) => c.id) : [] }),
    [stored.saved, defaults, view]);
  // One change at a time: a lever pressed while the last one saves would be laid over a stale board.
  const lever = (act) => { if (!stored.busy) stored.save(asStored(editBoard(drawn.panels, act))); };
  const addable = view ? addableEntries({
    kinds: stored.kinds, companyId, tiles: tiles.length, cards: view.cards, panels: drawn.panels, accounts: levelAccounts,
    companies: (companies || []).filter((c) => inScope(scope, c.id)), capability: choices.capability, names,
  }) : [];

  const toggle = (next) => { uiSound('toggle'); onFilter(same(filter, next) ? {} : next); };
  const onCell = (cell, from) => {
    const { door } = cell;
    if (door.kind === 'tab') { uiSound('toggle'); onTab(door.tab); return; }
    if (door.kind === 'read') { if (!reading.busy) reading.run(); return; }
    if (door.filter) toggle(door.filter);
    else uiSound('toggle');
    revealPanel(from, door.panel);
  };

  const showing = filterWords(filter);
  const b = {
    view, data, companies, accounts, levelAccounts, names, tiles, filter, toggle, showing, all, now, refresh, onTab, onZoom, onLoose, calm,
    mandate: mandateView, board: stored.saved,
    onAll: () => { uiSound('toggle'); setAll(!all); },
    onOpenCampaign: (id) => { uiSound('toggle'); onOpenCampaign(id); },
    litLoose: tiles.some((t) => !t.id && same(filter.accountIds, t.accountIds)),
    channelNames: Object.fromEntries((accounts || []).map((a) => [a.channelId, a.channelName])),
  };
  // Eight cells read as two rows of four (a cell's name and its word need the width); six fit one row.
  const cellsShown = cells && reading.busy ? cells.map((c) => (c.part === 'results' ? { ...c, what: 'reading…' } : c)) : cells;
  return (
    <section className="mko mkb" data-mkt-board data-health-root>
      {cellsShown ? <HealthStrip cells={cellsShown} label="Marketing health" cols={cellsShown.length > 6 ? 4 : cellsShown.length} onCell={onCell} /> : null}
      {Object.keys(errors).length ? <p className="settings-err">Could not read: {Object.entries(errors).map(([k, e]) => `${k} (${e})`).join(' · ')}</p> : null}
      {stored.error ? <p className="settings-err">Board: {stored.error}</p> : null}
      {/* A level's first board read is one local round trip: its grid waits blank, never a passing sentence. */}
      {!view ? <p className="settings-note">Reading the house&rsquo;s marketing…</p> : !stored.ready ? null : (
        <>
          <div className="sub-grid mkb-grid">
            {drawn.panels.map((entry, i) => (
              <BoardPanel key={entry.id} entry={entry} b={b} tools={(
                <PanelTools panel={entry} index={i} count={drawn.panels.length} name={panelWords(entry, view.cards, names) || entry.kind}
                  spans={stored.spans} busy={stored.busy} choices={choices} onLever={lever} />
              )} />
            ))}
          </div>
          <BoardEnd addable={addable} saved={drawn.saved} busy={stored.busy} gone={[...stored.dropped, ...drawn.gone]}
            onAdd={(entry) => lever({ lever: 'add', entry })} onReset={() => { uiSound('toggle'); stored.reset(); }} />
        </>
      )}
    </section>
  );
};
