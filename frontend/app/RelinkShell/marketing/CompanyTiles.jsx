// CompanyTiles — one tile per company a level holds (zoom-fold.js): at
// HOUSE every top-level company with its tree folded in, under a company
// each of its subsidiaries. A tile is one door: press it to zoom in. The
// NO COMPANY tile has nowhere to zoom, so its press narrows the board below
// to its accounts (the same door as the NO COMPANY count). A tile is its
// name, its legal form, its subsidiaries as a tree, then marks and numbers
// (SDT-3): its accounts by mark, its campaigns as segments lit while active
// beside active/all, and what waits on the operator there by StatusMark.
// What each group counts is said once, in the legend above the tiles.
// Pure rendering.

import { MARK } from '../marketing-overview/overview-words.js';
import { StatusMark } from '../StatusMark.jsx';

const MARKS = Object.freeze(['clear', 'failing', 'idle']);
// Past this many campaigns the segments would crowd the tile: the numbers alone say it.
const MAX_SEGMENTS = 12;
const WAITS = Object.freeze([['drafts', 'draft', 'to decide'], ['asks', null, 'asks for you'], ['failed', 'failed', 'failed sends']]);

/** One segment per campaign, lit while it is active (a discrete count of slots). */
const Segments = ({ lit, of }) => (of > 0 && of <= MAX_SEGMENTS ? (
  <span className="mkt-segs" aria-hidden="true">
    {Array.from({ length: of }, (_, i) => <i key={i} className={i < lit ? 'is-on' : ''} />)}
  </span>
) : null);

// The tile's numbers: its accounts by mark, its campaigns, what waits on the operator there.
const TileNumbers = ({ tile }) => {
  const { accounts, waiting } = tile;
  const waits = WAITS.filter(([k]) => waiting[k] > 0);
  return (
    <span className="mkt-tile-nums">
      <span className="mkt-num" data-tile-accounts title={`${accounts.total} account(s)`}>
        {accounts.total ? MARKS.filter((m) => accounts[m] > 0).map((m) => (
          <span key={m} className="mkt-mark-n" title={`${accounts[m]} ${MARK[m].words}`}>
            <i className={`mko-mark is-${m}`}>{MARK[m].glyph}</i><b>{accounts[m]}</b>
          </span>
        )) : <span className="mkt-mark-none"><i className="mko-mark is-idle">○</i><b>0</b></span>}
      </span>
      <span className="mkt-num" data-tile-active title={`${tile.active} of ${tile.campaigns} campaign(s) active`}>
        <Segments lit={tile.active} of={tile.campaigns} /><b>{tile.active}</b><small>/{tile.campaigns}</small>
      </span>
      {waits.length ? (
        <span className="mkt-waits" title="waiting on you here">
          <i aria-hidden="true">◆</i>
          {waits.map(([k, status, words]) => (
            <span key={k} data-wait={k} title={`${waiting[k]} ${words}`}>
              {status ? <StatusMark status={status} title={words} /> : <small>ASKS</small>}<b>{waiting[k]}</b>
            </span>
          ))}
        </span>
      ) : <span className="mkt-waits is-clear" title="nothing waits on you here"><i aria-hidden="true">◇</i></span>}
    </span>
  );
};

/** What each number on a tile counts, said once above the tiles. */
const TilesLegend = () => (
  <span className="mkt-tiles-key" data-tiles-legend>
    <span><i className="mko-mark is-clear">●</i><i className="mko-mark is-failing">◐</i><i className="mko-mark is-idle">○</i>ACCOUNTS</span>
    <span><span className="mkt-segs"><i className="is-on" /><i /></span>ACTIVE</span>
  </span>
);

const CompanyTile = ({ tile, lit, onPress }) => (
  <button type="button" className={`mkt-tile cham${tile.id ? '' : ' is-loose'}${lit ? ' is-lit' : ''}`}
    data-company-tile={tile.id || 'none'} aria-pressed={tile.id ? undefined : lit} onClick={onPress}>
    <span className="mkt-tile-in cham-in">
      <span className="mkt-tile-head">
        <b className="mkt-tile-name">{tile.name}</b>
        {tile.id ? <span className="mkt-tile-go" aria-hidden="true">›</span> : null}
      </span>
      {tile.legal ? <span className="mkt-tile-legal">{tile.legal}</span> : null}
      {tile.subs.length ? (
        <span className="mkt-tile-subs">
          {tile.subs.map((s) => <span key={s.id} style={{ paddingLeft: `${(s.depth - 1) * 16}px` }}>└ {s.name}</span>)}
        </span>
      ) : null}
      <TileNumbers tile={tile} />
    </span>
  </button>
);

/**
 * @param {{tiles: object[], litLoose: boolean, onZoom: (companyId: string) => void, onLoose: (accountIds: string[]) => void}} props
 */
export const CompanyTiles = ({ tiles, litLoose, onZoom, onLoose }) => (tiles.length ? (
  <>
    <TilesLegend />
    <div className="mkt-tiles" data-mkt-tiles>
      {tiles.map((t) => (
        <CompanyTile key={t.id || 'none'} tile={t} lit={!t.id && litLoose}
          onPress={() => (t.id ? onZoom(t.id) : onLoose(t.accountIds))} />
      ))}
    </div>
  </>
) : null);
