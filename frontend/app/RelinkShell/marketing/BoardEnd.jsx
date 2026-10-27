// BoardEnd — the last row of a MARKETING board (marketing-panel-plan.md §4):
// + PANEL (the desk's CtxMenu, listing what this level's board may still
// hold: its kinds; a kind with several — a campaign each, a platform or an
// account each, a company each — is a page of its own, like a panel's
// WIDTH, so the menu shows one decision at a time), ↺ DEFAULT once the
// operator has laid the board out themselves, and a mark for the panels the
// board dropped (a campaign gone, a company deleted), each named in its hover.
//
// impure — the menu's open state; the acts are the board's.

import { useState } from 'react';
import { CtxMenu } from '../CtxMenu.jsx';

/**
 * pure — ADD PANEL's items on one page: the main page lists each group once
 * (a lone entry as itself, several as a page turn); a group's page, the way
 * back and its entries.
 * @param {Array<{id: string, label: string, group?: string}>} addable
 * @param {?string} page - a group, or null for the main page
 */
export const addMenuItems = (addable, page) => {
  const groupOf = (a) => a.group || a.label;
  if (page) {
    return [{ kind: 'item', id: 'group:', label: `‹  ${page}`, stay: true }, { kind: 'separator' },
      ...addable.filter((a) => groupOf(a) === page).map((a) => ({ kind: 'item', id: a.id, label: a.label }))];
  }
  const groups = [...new Set(addable.map(groupOf))];
  return groups.map((g) => {
    const of = addable.filter((a) => groupOf(a) === g);
    return of.length === 1 ? { kind: 'item', id: of[0].id, label: of[0].label } : { kind: 'item', id: `group:${g}`, label: `${g} · ${of.length}  ›`, stay: true };
  });
};

/**
 * @param {{addable: Array<{id: string, label: string, entry: object}>, saved: boolean, busy: boolean,
 *   gone: Array<{id: string, kind: string, why: string}>, onAdd: (entry: object) => void, onReset: () => void}} props
 */
export const BoardEnd = ({ addable, saved, busy, gone, onAdd, onReset }) => {
  const [at, setAt] = useState(null);
  const [page, setPage] = useState(null);
  const open = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPage(null);
    setAt({ x: r.left, y: r.bottom + 2 });
  };
  const items = addMenuItems(addable, page);
  const onAct = (id) => {
    if (id.startsWith('group:')) { setPage(id.slice('group:'.length) || null); return; }
    const a = addable.find((x) => x.id === id);
    if (a) onAdd(a.entry);
  };
  return (
    <div className="mkb-end" data-mkb-end>
      {addable.length ? (
        <button type="button" className="mko-link mkb-add" data-mkb-add aria-haspopup="menu" aria-expanded={Boolean(at)} disabled={busy}
          title="add a panel to this board" onClick={open}>+ PANEL</button>
      ) : null}
      {saved ? (
        <button type="button" className="mko-link mkb-reset" data-mkb-reset disabled={busy} aria-label="reset this board to its default"
          title="lay this board out as it was before you changed it" onClick={onReset}>↺ DEFAULT</button>
      ) : null}
      {gone.length ? (
        <span className="mkb-gone" data-mkb-gone title={gone.map((g) => `${g.id}: ${g.why}`).join('\n')}>
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeDasharray="2 2" /></svg>
          {`${gone.length} GONE`}
        </span>
      ) : null}
      {at ? (
        // Keyed by page: a kind's page is a fresh menu at the same spot.
        <CtxMenu key={page || 'main'} className="mkb-menu" at={at} items={items} onClose={() => setAt(null)} onAct={onAct} />
      ) : null}
    </div>
  );
};
