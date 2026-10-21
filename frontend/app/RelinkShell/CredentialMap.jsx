// CredentialMap — Settings → API at a glance: how many credentials are proven,
// set, failing or missing (each count filters the forms below; the same press
// again shows all), and one tile per credential under what it unlocks (a tile
// opens its row). The vocabulary is credential-view.js.
//
// Rendering only — no IO, no sound (a row's one effect scrolls it into view as it opens).

import './credential-map.css';
import { useEffect, useRef } from 'react';
import { CREDENTIAL_STATES, STATE_LABEL, groupItems, stateCounts } from './credential-view.js';

export const CredentialMap = ({ items, stateFilter, onState, onOpen }) => {
  if (!items.length) return null;
  const counts = stateCounts(items);
  const shown = CREDENTIAL_STATES.filter((s) => counts[s] > 0);
  return (
    <section className="cred-map" aria-label="credential map">
      <div className="cred-tally">
        <span className="cred-tally-bar" aria-hidden="true">
          {shown.map((s) => <i key={s} className={`cred-st-${s}`} style={{ flexGrow: counts[s] }} />)}
        </span>
        <span className="cred-tally-counts">
          {shown.map((s) => (
            <button
              key={s}
              type="button"
              className={`cred-count cred-tx-${s}${stateFilter === s ? ' is-lit' : ''}`}
              aria-pressed={stateFilter === s}
              onClick={() => onState(stateFilter === s ? '' : s)}
            >
              <b>{counts[s]}</b>{STATE_LABEL[s]}
            </button>
          ))}
          <span className="cred-total">OF {items.length}</span>
        </span>
      </div>
      <div className="cred-groups">
        {groupItems(items).map(({ group, items: list }) => (
          <div key={group} className="cred-group">
            <p className="cred-group-head">{group}<span>{list.filter((i) => i.state === 'proven' || i.state === 'set' || i.state === 'keyless').length}/{list.length}</span></p>
            <div className="cred-tiles">
              {list.map((i) => (
                <button
                  key={i.key}
                  type="button"
                  className={`cred-tile cred-edge-${i.state}${stateFilter && stateFilter !== i.state ? ' is-dim' : ''}`}
                  title={`${i.name} — ${STATE_LABEL[i.state]}${i.detail ? ` · ${i.detail}` : ''}`}
                  onClick={() => onOpen(i.key)}
                >
                  <span className="cred-tile-name">{i.name}</span>
                  <span className={`cred-tile-state cred-tx-${i.state}`}>{STATE_LABEL[i.state]}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

/**
 * One credential as one row — state edge, name, state, where its value comes
 * from — opening onto its form. A row opened from the map scrolls into view.
 */
export const CredentialRow = ({ item, open, onToggle, children }) => {
  const node = useRef(null);
  // scroll once as it opens — never on the re-renders typing into its form makes
  useEffect(() => { if (open) node.current?.scrollIntoView({ block: 'nearest' }); }, [open]);
  return (
    <div ref={node} className={`cred-item${open ? ' is-open' : ''}`}>
      <button type="button" className={`cred-row cred-edge-${item.state}`} aria-expanded={open} onClick={onToggle}>
        <span>{item.name}</span>
        <span className={`cred-row-state cred-tx-${item.state}`}>{STATE_LABEL[item.state]}</span>
        <span className="cred-row-detail">{item.detail ?? ''}</span>
        <span className="cred-row-open">{open ? 'CLOSE' : 'OPEN'}</span>
      </button>
      {open ? <div className="cred-body">{children}</div> : null}
    </div>
  );
};
