// PanelTools — the end of a MARKETING panel's title row (marketing-panel-plan.md
// §4): its marks (pinned by you; laid out by the CMO) and its ⋯ menu, the
// desk's one CtxMenu: WIDTH (a page of the five widths), the panel's own
// choices where it has them (board-choices.js: SHOW, WINDOW, BY, TOP, ON —
// each a page, metrics only as the platform reports them), MOVE EARLIER /
// LATER, PIN / UNPIN, HIDE. The ⋯ is a button, so the keyboard reaches it; the menu
// walks with the arrows. Every choice is the board's to save.
//
// impure — the menu's open state; the acts are the board's.

import { useState } from 'react';
import { CtxMenu } from '../CtxMenu.jsx';
import { panelMenuItems, widthMenuItems, leverOf } from './board-edit.js';
import { choicePages, choiceItems, choiceLeverOf } from './board-choices.js';

/** The pin, drawn: a head and its point. */
const PinMark = () => (
  <svg viewBox="0 0 12 14" width="10" height="12" aria-hidden="true" focusable="false">
    <circle cx="6" cy="4" r="3.25" fill="currentColor" />
    <path d="M6 7.5 V13.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/**
 * @param {{panel: object, index: number, count: number, name: string, spans?: number[], busy: boolean,
 *   choices?: {capability: object, platforms: string[], names?: object}, onLever: (act: object) => void}} props
 *   `choices` — what the panel's choice pages may offer (board-choices.js)
 */
export const PanelTools = ({ panel, index, count, name, spans, busy, choices = { capability: {}, platforms: [] }, onLever }) => {
  const [menu, setMenu] = useState(null); // { at, page } | null
  const open = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ at: { x: r.left, y: r.bottom + 2 }, page: 'main' });
  };
  const turn = (page) => setMenu((m) => (m ? { ...m, page } : m));
  const onAct = (id) => {
    if (id === 'width-page' || id === 'width-back') { turn(id === 'width-page' ? 'width' : 'main'); return; }
    if (id.startsWith('page:')) { turn(id.slice('page:'.length)); return; }
    const act = leverOf(id, panel) || choiceLeverOf(id, panel, choices);
    if (act) onLever(act);
  };
  const page = menu?.page;
  const items = !menu ? [] : page === 'width' ? widthMenuItems(panel.span, spans || undefined)
    : page === 'main' ? panelMenuItems(panel, index, count, choicePages(panel, choices)) : choiceItems(page, panel, choices);
  return (
    <span className="mkb-tools">
      {panel.pinned ? <span className="mkb-mark" data-mark="pin" title="pinned by you: the CMO cannot move or remove it"><PinMark /></span> : null}
      {panel.setBy === 'cmo' ? <span className="mkb-mark mkb-cmo" data-mark="cmo" title="laid out by the CMO">CMO</span> : null}
      <button type="button" className="mkb-more" data-panel-menu={panel.id} aria-haspopup="menu" aria-expanded={Boolean(menu)} aria-busy={busy}
        aria-label={`${name}: width, what it shows, move, pin, hide`} title="width, what it shows, move, pin, hide" onClick={open}>⋯</button>
      {menu ? (
        // Keyed by page: turning to the widths is a fresh menu at the same spot.
        <CtxMenu key={menu.page} className="mkb-menu" at={menu.at} items={items} onAct={onAct} onClose={() => setMenu(null)} />
      ) : null}
    </span>
  );
};
