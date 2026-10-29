// ZoomPath — where the operator stands in MARKETING, and the way back up:
// HOUSE › company › subsidiary … › PLATFORM @handle. Every crumb above the
// current one is a door; the current one is where you are. Beside it, the
// level's tabs (the same strip a platform's boards use). Pure rendering.

import { Fragment } from 'react';
import { TAB_LABELS } from './zoom-fold.js';
import { BrandMark } from '../brand-marks.jsx';

/**
 * @param {{crumbs: Array<{id: string, name: string}>, onGo: (companyId: ?string) => void,
 *   account?: ?{channelId: string, name: string, handle: ?string, title: string}}} props
 *   account — the account level's crumb (account-level.js accountCrumb), the deepest, where you are
 */
export const ZoomPath = ({ crumbs, onGo, account = null }) => {
  const here = account ? undefined : crumbs.length ? crumbs[crumbs.length - 1].id : null;
  return (
    <nav className="mkt-path" aria-label="where you are" data-mkt-path>
      {here !== null ? <button type="button" className="mkt-crumb" onClick={() => onGo(null)}>HOUSE</button>
        : <span className="mkt-crumb is-here" aria-current="page">HOUSE</span>}
      {crumbs.map((c) => (
        <Fragment key={c.id}>
          <span className="mkt-sep" aria-hidden="true">›</span>
          {c.id === here ? <span className="mkt-crumb is-here" aria-current="page">{c.name}</span>
            : <button type="button" className="mkt-crumb" onClick={() => onGo(c.id)}>{c.name}</button>}
        </Fragment>
      ))}
      {account ? (
        <>
          <span className="mkt-sep" aria-hidden="true">›</span>
          <span className="mkt-crumb is-here mkt-crumb-account" aria-current="page" title={account.title} data-mkt-crumb-account={account.channelId}>
            <BrandMark id={account.channelId} />{account.name}{account.handle ? <span className="mkt-crumb-handle">{account.handle}</span> : null}
          </span>
        </>
      ) : null}
    </nav>
  );
};

/** @param {{tabs: readonly string[], on: string, onTab: (tab: string) => void}} props */
export const OfficeTabs = ({ tabs, on, onTab }) => (
  <div className="outreach-tabs mkt-tabs" role="tablist" aria-label="marketing">
    {tabs.map((t) => (
      <button key={t} type="button" role="tab" aria-selected={on === t} data-tab={t}
        className={`outreach-tab label-data${on === t ? ' is-on' : ''}`} onClick={() => onTab(t)}>
        {TAB_LABELS[t]}
      </button>
    ))}
  </div>
);
