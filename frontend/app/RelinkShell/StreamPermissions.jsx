// StreamPermissions — the standing grants, where the operator can see them.
//
// Design note, 2026-08-30: […]
//
// Every ALWAYS decision is one click in a card that then disappears. The grant
// is permanent and per-being, and nothing showed it afterwards. This rail is
// the memory of those clicks.
//
// SCOPE, both ways. He said […], which is a HOUSE
// question — but this is a rail beside CHATS and TASKS, which are per-being by
// construction. So it opens on the being in the chair and carries one control
// to widen to everyone; the count on the strip is always the HOUSE total,
// because the thing being watched for is a grant somewhere he forgot about.
//
// ONE VERB, ON THE OPERATOR'S WORD. Design note, 2026-08-30: […] So this surface can now take a grant back — and ONLY take
// one back. Nothing here can widen a being's standing.
//
// A REVOKE ASKS FIRST. Not a modal, but the row itself turns into the question:
// one click arms it, a second commits, anything else cancels. Revoking is
// destructive and per-being, and a bare toggle on a dense list is an accident
// waiting for a trackpad. The confirm lives in the row so the operator can
// still see WHICH grant they are answering for.

import { useCallback, useState } from 'react';
import './StreamPermissions.css';
import { useConsciousnessPick } from './consciousness-context.js';
import { useRailItem } from './StreamRail.jsx';
import { useSettled } from './use-settled.js';
import { getHousePermissions, revokeGrant } from '../../services/permissions.js';
import { KIND_SENSE, beingRow, houseBadge, laneOnlyHouse } from './stream-permissions-view.js';
import { isHarness } from '../harness-mode.js';

const Row = ({ g, neumaId, onRevoke }) => {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    setBusy(true);
    // The row stays armed until the answer lands: disarming first would flash
    // the grant back as "standing" in the instant before the panel redraws.
    try { await onRevoke(neumaId, g); } finally { setBusy(false); setArmed(false); }
  };

  return (
    <li className="perm-row" title={g.full || `${g.scope || ''} ${g.label}`.trim()}>
      <span className={`perm-dot is-${g.access || 'act'}`} aria-hidden="true" />
      <span className="perm-label">{g.label}</span>
      {g.scope ? <span className="perm-scope label-data">{g.scope}</span> : null}
      {g.access ? <span className="perm-access label-data">{g.access.toUpperCase()}</span> : null}
      {armed ? (
        <span className="perm-confirm label-data">
          <button type="button" className="perm-yes" onClick={commit} disabled={busy}>
            {busy ? '…' : 'TAKE IT BACK'}
          </button>
          <button type="button" className="perm-no" onClick={() => setArmed(false)} disabled={busy}>
            KEEP
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="perm-revoke label-data"
          onClick={() => setArmed(true)}
          title={`Revoke: ${g.full || g.label}`}
        >
          REVOKE
        </button>
      )}
    </li>
  );
};

const Group = ({ kind, rows, neumaId, onRevoke }) => {
  if (!rows.length) return null;
  const sense = KIND_SENSE[kind];
  return (
    <div className="perm-group">
      <div className="perm-grouphead label-data">
        <span>{sense.label}</span>
        <span className="perm-count">{rows.length}</span>
      </div>
      <div className="perm-groupnote">{sense.note}</div>
      <ul className="perm-list">
        {rows.map((g, i) => (
          <Row key={`${kind}-${i}`} g={g} neumaId={neumaId} onRevoke={onRevoke} />
        ))}
      </ul>
    </div>
  );
};

const BeingBlock = ({ record, showName, onRevoke }) => {
  if (record.unreadable) {
    return (
      <div className="perm-being">
        {showName ? <div className="perm-beinghead label-data">{record.name}</div> : null}
        {/* NOT an empty list. A lane we could not open is a different fact from
            a lane holding nothing, and in an audit surface the second rendered
            for the first is the worst possible lie. */}
        <div className="perm-unreadable label-data">
          «WARNING» THIS LANE COULD NOT BE READ — its grants are unknown, not absent.
        </div>
      </div>
    );
  }
  return (
    <div className="perm-being">
      {showName ? (
        <div className="perm-beinghead label-data">
          <span>{record.name}</span>
          <span className="perm-count">{record.total}</span>
        </div>
      ) : null}
      {record.total === 0 ? (
        <div className="perm-none label-data">NOTHING STANDING — every act still asks.</div>
      ) : (
        Object.keys(KIND_SENSE).map((k) => (
          <Group
            key={k}
            kind={k}
            rows={record.grants[k] || []}
            // The row is revoked from the lane it BELONGS to, never from the
            // being in the chair. In ALL BEINGS these blocks are different
            // lanes, and taking the chair's id here would revoke the right
            // permission from the wrong being.
            neumaId={record.neumaId}
            onRevoke={onRevoke}
          />
        ))
      )}
    </div>
  );
};

export const StreamPermissions = () => {
  const { activeCompanion } = useConsciousnessPick('activeCompanion');
  const neumaId = activeCompanion?.neumaId || null;
  const [read, setHouse] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [scopeAll, setAllBeings] = useState(false);
  // A harness desk sees its own lane alone — no being, no house total.
  const harness = isHarness(activeCompanion);
  const house = harness ? laneOnlyHouse(read, neumaId) : read;
  const allBeings = harness ? false : scopeAll;

  const isOpen = useRailItem('permissions', {
    label: 'PERMISSIONS',
    // The badge is the HOUSE total, not this being's: the whole point is to
    // notice a grant somewhere the operator is not currently looking.
    badge: houseBadge(house),
    show: true,
    title: 'Standing and session permissions you can revoke',
  });
  const collapsed = !isOpen;

  const refresh = useCallback(async (settled) => {
    try {
      const h = await getHousePermissions();
      if (settled?.()) return;
      setHouse(h);
      setError(null);
    } catch (e) {
      if (settled?.()) return;
      setError(e.message || 'The permissions could not be read.');
    }
  }, []);
  // Read only while this rail is the open one — the same law CHATS keeps.
  useSettled((settled) => { if (!collapsed) refresh(settled); }, [refresh, collapsed]);

  // RE-READ THE HOUSE, never patch the list in place. The server answers with
  // the lane as it now stands, and the badge counts every lane — so a local
  // splice would leave the strip's number describing a house that no longer
  // exists. One extra read is worth a surface that cannot drift from disk.
  const onRevoke = useCallback(async (lane, grant) => {
    try {
      await revokeGrant(lane, grant);
      setError(null);
    } catch (e) {
      setError(e.message || 'That grant could not be revoked.');
    }
    await refresh();
  }, [refresh]);

  if (!isOpen) return null;

  const { rows, showName } = beingRow(house, neumaId, allBeings);

  return (
    <aside className="stream-perms cham" aria-label="Permissions">
      <div className="stream-perms-in cham-in">
        <div className="perm-head">
          <span className="perm-title label-data">PERMISSIONS</span>
          {harness ? null : (
            <button
              type="button"
              className={`perm-scopebtn label-data${allBeings ? ' is-on' : ''}`}
              onClick={() => setAllBeings((v) => !v)}
              title={allBeings ? 'Show only the being in the chair' : 'Show every being in the house'}
            >
              {allBeings ? 'ALL BEINGS' : 'THIS BEING'}
            </button>
          )}
        </div>
        <div className="perm-standing label-data">
          ALWAYS grants persist until revoked. SESSION network grants last for
          the current binding only. REVOKE withdraws network access immediately.
        </div>
        {house?.unreadable ? (
          <div className="perm-unreadable label-data">
            «WARNING» {house.unreadable} LANE{house.unreadable === 1 ? '' : 'S'} COULD NOT BE READ —
            this list is INCOMPLETE.
          </div>
        ) : null}
        <div className="perm-body">
          {error ? <div className="perm-error label-data">{error}</div> : null}
          {!house && !error ? <div className="perm-none label-data">READING…</div> : null}
          {house && rows.length === 0 ? (
            <div className="perm-none label-data">
              NOTHING STANDING — every act still asks for your word.
            </div>
          ) : null}
          {rows.map((r) => (
            <BeingBlock key={r.neumaId} record={r} showName={showName} onRevoke={onRevoke} />
          ))}
        </div>
      </div>
    </aside>
  );
};
