// HouseRail — the whole house down the left of MARKETING (Design note, 2026-11-12:
// every company in its tree with its own campaigns (◆) and accounts under it,
// what names no company last. Where the operator stands is lit; one press goes
// anywhere — a company's level, a campaign's page, an account's level, HOUSE. A company's ⋯ moves it
// under another company (or to the top); an account's ⋯ moves it to a
// company. The rows are house-tree.js; the moves are the house's own routes.
//
// impure — the two moves, then the house's read again.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { setCompanyParent } from '../../../services/company-sources-client.js';
import { updateAccount } from '../../../services/social-accounts-client.js';
import { loadHouseAccounts } from '../accounts/use-house-accounts.js';
import { BrandMark } from '../brand-marks.jsx';
import { CtxMenu } from '../CtxMenu.jsx';
import { houseTreeRows, companyMoveTargets, accountMoveTargets, isHere } from './house-tree.js';
import './house-rail.css';

const menuItems = (targets, head) => [
  { kind: 'item', id: '__head', label: head, stay: true },
  { kind: 'separator' },
  ...targets.map((t) => ({ kind: 'item', id: t.id, label: t.label, checked: t.checked })),
];

/**
 * @param {{companies: object[], accounts: object[], campaigns?: object[], here: object,
 *   onHouse: () => void, onCompany: (id: string) => void, onCampaign: (id: string) => void,
 *   onAccount: (account: {channelId: string, accountId: string}) => void,
 *   onMoved: () => void}} props
 */
export const HouseRail = ({ companies, accounts, campaigns = [], here, onHouse, onCompany, onCampaign, onAccount, onMoved }) => {
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = houseTreeRows({ companies, accounts, campaigns });

  const open = (e, row) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const targets = row.kind === 'company' ? companyMoveTargets(companies, row.id) : accountMoveTargets(companies, row.companyId);
    setMenu({ at: { x: r.left, y: r.bottom + 2 }, row, items: menuItems(targets, row.kind === 'company' ? `MOVE ${row.name} UNDER` : `MOVE ${row.name} TO`) });
  };

  const move = async (row, target) => {
    if (target === '__head' || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (row.kind === 'company') await setCompanyParent(row.id, target === 'top' ? null : target);
      else await updateAccount(row.id, { companyId: target });
      await loadHouseAccounts({ force: true });
      onMoved();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const go = (row) => {
    uiSound('toggle');
    if (row.kind === 'house') onHouse();
    else if (row.kind === 'company') onCompany(row.id);
    else if (row.kind === 'campaign') onCampaign(row.id);
    else if (row.kind === 'account') onAccount({ channelId: row.channelId, accountId: row.id });
  };

  return (
    <nav className="mkt-rail" aria-label="the house — companies and accounts" data-mkt-rail>
      {rows.map((row) => {
        const lit = isHere(row, here);
        const movable = row.kind === 'company' || row.kind === 'account';
        return (
          <div key={row.key} className={`mkt-rail-row is-${row.kind}${lit ? ' is-here' : ''}`} style={{ '--depth': row.depth }} data-rail-row={row.key}>
            {row.kind === 'unsorted'
              ? <span className="mkt-rail-go is-label" title="accounts no company holds yet — move each to its company">{row.name}</span>
              : (
                <button type="button" className="mkt-rail-go" aria-current={lit ? 'page' : undefined} title={row.title || row.name} onClick={() => go(row)}>
                  {row.kind === 'account' ? <BrandMark id={row.channelId} /> : null}
                  {row.kind === 'campaign' ? <span className={`mkt-rail-glyph is-${row.status}`} aria-hidden="true">◆</span> : null}
                  <span className="mkt-rail-name">{row.name}</span>
                </button>
              )}
            {movable ? (
              <button type="button" className="mkt-rail-more" aria-label={`move ${row.name}`} title={row.kind === 'company' ? 'move under another company' : 'move to a company'}
                disabled={busy} onClick={(e) => open(e, row)} data-rail-move={row.key}>⋯</button>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="settings-err mkt-rail-err" role="alert">{error}</p> : null}
      {menu ? (
        <CtxMenu className="mkb-menu" at={menu.at} items={menu.items} onClose={() => setMenu(null)} onAct={(id) => move(menu.row, id)} />
      ) : null}
    </nav>
  );
};
