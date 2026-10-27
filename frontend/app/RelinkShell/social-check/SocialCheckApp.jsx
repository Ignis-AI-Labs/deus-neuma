// SocialCheckApp — the SOCIAL CHECK window in the MARKETING band (campaign
// plan §6.1, slice 11), and MARKETING's ACCOUNTS tab: is every account the
// house uses ready to speak? Shown, not told (Design note, 2026-10-24: […]; […]).
//
// The house's line and RECHECK; then the guided path — every fix the house
// owes, numbered, each a door; then each company with one card per account
// in use (its platform, its name, its verdict, one mark per check, hover
// names it). The focused card opens its fixes: a short title, a door to the
// exact place, a fix in place for the @handle, and HAND TO <member> where a
// member of this house can do it. OPTIONAL stands apart, folded, never
// counted. A result arriving while the person points at the path or the
// cards waits until they leave (calm-gate.js) — it never re-lays under them.
// impure — network, the desk's windows.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { getHouseCheck } from '../../../services/social-check-client.js';
import { updateAccount } from '../../../services/social-accounts-client.js';
import { useWindows } from '../../windowing/use-windows.js';
import { useCalmGate } from '../use-calm-gate.js';
import { takeCardLanding, onCardLanding } from '../card-landing.js';
import { overviewRows, focusedAccount, tallyWords, narrowCheck, fixSteps } from './social-check-view.js';
import { GuidedPath, AccountCard, OptionalGroup } from './SocialCheckParts.jsx';
import { openDoor } from '../doors/open-door.js';
import { handOver } from '../doors/hand-over.js';
import './social-check.css';

const INTRO = 'Every account the house uses — it has keys, a holder, or a part in an active campaign — proven on its own keys. Read only: nothing is changed here but an @handle you record.';

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

// impure — the check, read on arrival and again on RECHECK; a result offered
// through the calm gate, so it waits while the person points at the cards.
const useHouseCheck = (calm) => {
  const [read, setRead] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const run = useCallback(async ({ fresh = false } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const { check, locked } = await getHouseCheck({ fresh });
      // The house's keys file can't be opened: no account can be checked — said, never "checking…" forever.
      if (locked) throw new Error('▲ KEYS LOCKED — no account can be checked until the keys file opens');
      const apply = () => { setRead(check); setHeld(false); };
      if (fresh) setHeld(!calm.offer('check', apply));
      else calm.now('check', apply);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }, [calm]);
  useEffect(() => { run(); }, [run]);
  return { read, error, busy, held, run };
};

/**
 * The SOCIAL CHECK window's body — and MARKETING's ACCOUNTS tab, where
 * `scope` (a company's subtree; null = the house) narrows it.
 */
export const SocialCheckApp = ({ scope = null }) => {
  const calm = useCalmGate();
  const { read, error, busy, held, run } = useHouseCheck(calm);
  const check = narrowCheck(read, scope);
  const windows = useWindows();
  // A door onto one account (the grant's pre-flight: that account's card) opens it focused.
  const [asked, setAsked] = useState(() => takeCardLanding('social-check')?.accountId ?? null);
  useEffect(() => onCardLanding('social-check', (item) => setAsked(item?.accountId ?? null)), []);
  const [recording, setRecording] = useState(null);
  const [actError, setActError] = useState(null);
  const [handed, setHanded] = useState({});

  const focused = check ? focusedAccount(check, asked) : null;
  const steps = useMemo(() => (check ? fixSteps(check) : []), [check]);
  const companyName = useMemo(() => new Map((check?.companies || []).map((c) => [c.id, c.name])), [check]);
  const channelNames = check?.channelNames || {};

  const pick = (id) => { uiSound('toggle'); setAsked(id); };
  const onDoor = (door) => { uiSound('open'); setActError(null); openDoor(door, windows); };
  const onHand = async (accountId, checkId, handTo) => {
    uiSound('open');
    setActError(null);
    try {
      if (await handOver(handTo, windows)) setHanded((h) => ({ ...h, [`${accountId}:${checkId}`]: true }));
    } catch (e) {
      setActError(e.message);
    }
  };
  const onRecord = async (accountId, handle) => {
    uiSound('toggle');
    setRecording(accountId);
    setActError(null);
    try {
      await updateAccount(accountId, { expectedHandle: handle });
      await run({ fresh: true });
    } catch (e) {
      setActError(e.message);
    }
    setRecording(null);
  };
  // A step of the path is a door; the @handle's is fixed in place, so the step opens that card on its field.
  const onStep = (step) => {
    if (step.door.kind !== 'handle') { onDoor(step.door); return; }
    pick(step.door.accountId);
    requestAnimationFrame(() => globalThis.document?.querySelector(`[data-handle-for="${step.door.accountId}"]`)?.focus());
  };
  const acts = { canOpen: Boolean(windows?.dispatch), onDoor, onHand, onRecord, recording, handed };

  return (
    <section className="settings-sec social-check" aria-description={INTRO}>
      <div className="social-check-head">
        <div className="label-data settings-h sc-headline" title={INTRO}>{check ? check.headline : 'SOCIAL CHECK'}</div>
        {held ? <span className="sc-held" role="status" title="the new result lands when the pointer leaves the cards">NEW RESULT WAITS</span> : null}
        <span className="sc-checked" title={check?.checkedAt || ''}>{check ? `checked ${clock(check.checkedAt)}` : ''}</span>
        <button type="button" className="settings-set sc-recheck" disabled={busy} onClick={() => { uiSound('toggle'); run({ fresh: true }); }}>
          {busy ? 'CHECKING…' : 'RECHECK'}
        </button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
      {actError ? <p className="settings-err">{actError}</p> : null}
      {!check && !error ? <p className="settings-note">Checking every account…</p> : null}
      {check ? (
        <div className="sc-body" {...calm.handlers}>
          {steps.length ? <GuidedPath steps={steps} channelNames={channelNames} onStep={onStep} /> : null}
          <div className="social-check-overview">
            {overviewRows(check).map((r) => (
              <div key={r.key} className={`social-check-company depth-${Math.min(r.depth, 3)}`}>
                <div className="sc-company-head">
                  <span className="social-check-name">{r.name}</span>
                  <span className="social-check-tally">
                    {tallyWords(r.tally)}{r.treeTally && r.treeTally.companies.length > 1 ? ` · TREE ${tallyWords(r.treeTally)}` : ''}
                  </span>
                </div>
                {r.rows.length ? (
                  <div className="sc-cards">
                    {r.rows.map((row) => (
                      <AccountCard key={row.id} row={row} companyName={companyName.get(row.companyId)} focused={focused?.id === row.id}
                        onPick={pick} acts={acts} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {focused ? null : <p className="settings-note">No account is in use yet.</p>}
          <OptionalGroup optional={check.optional} channelNames={channelNames} />
        </div>
      ) : null}
    </section>
  );
};
