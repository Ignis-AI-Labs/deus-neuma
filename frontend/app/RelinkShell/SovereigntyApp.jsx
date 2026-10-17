// SovereigntyApp — the operator's seat at the gateway. A being proposes a
// change to itself; the ruling happens HERE, with the FULL words disclosed —
// never a truncated preview, because approving words you have not read whole
// is not a ruling. No clock runs on a verdict. Every state flip is believed
// only on server echo, and a broken amendment chain SCREAMS across the top
// instead of rendering as an empty record.

import { useEffect, useState, useCallback } from 'react';
import './SovereigntyApp.css';
import { loadSovereignty, decideProposal, retractAmendment, askConsent, signAndApplyDna } from './sovereignty-client.js';
import { uiSound } from '../../services/ui-sound.js';
import { useActiveCompanion } from './consciousness-context.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useSettled } from './use-settled.js';

const SovereigntyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M8 1.5 L13.5 4.5 V8 C13.5 11.5 11 13.8 8 14.5 C5 13.8 2.5 11.5 2.5 8 V4.5 Z" />
    <path d="M5.5 8 L7.3 9.8 L10.6 6.2" />
  </svg>
);

const STATUS_BADGE = {
  applied: 'APPLIED', declined: 'DECLINED', withdrawn: 'WITHDRAWN', revise: 'RETURNED', approved: 'APPROVED',
};

// One open proposal awaiting the ruling — full disclosure, three doors.
const ProposalCard = ({ neumaId, proposal, onEcho, onError }) => {
  const [revising, setRevising] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const rule = async (verdict, verdictNotes) => {
    uiSound('activate');
    setBusy(true);
    const r = await decideProposal(neumaId, proposal.id, verdict, verdictNotes);
    setBusy(false);
    if (!r.ok) { onError(r.error); return; }
    onEcho();
  };

  return (
    <article className="sov-card cham" data-testid="sov-proposal">
      <header className="sov-card-head">
        <span className="sov-card-title">{proposal.title}</span>
        <span className="sov-meta label-data">{proposal.submittedAt.slice(0, 10)} · no clock runs</span>
      </header>
      <p className="sov-body">{proposal.body}</p>
      <div className="sov-words">
        <span className="sov-words-label label-data">
          {proposal.class === 'toolset' ? 'THE GRANT — ALWAYS ALLOW' : 'THE WORDS TO STAND — WHOLE'}
        </span>
        <p className="sov-words-text" data-testid="sov-words">
          {proposal.class === 'toolset' ? `${proposal.patch?.server}/${proposal.patch?.tool}` : proposal.patch?.text}
        </p>
      </div>
      {revising ? (
        <div className="sov-revise">
          <textarea
            className="sov-notes" data-testid="sov-notes" rows={3}
            placeholder="Notes the being can act on — returned verbatim."
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />
          <div className="sov-actions">
            <button type="button" className="sov-btn" disabled={busy || !notes.trim()} onClick={() => rule('revise', notes.trim())}>RETURN WITH NOTES</button>
            <button type="button" className="sov-btn" disabled={busy} onClick={() => { uiSound('close'); setRevising(false); }}>CANCEL</button>
          </div>
        </div>
      ) : (
        <div className="sov-actions">
          <button type="button" className="sov-btn sov-btn-go" data-testid="sov-approve" disabled={busy} onClick={() => rule('approve')}>APPROVE — IT STANDS</button>
          <button type="button" className="sov-btn" data-testid="sov-revise" disabled={busy} onClick={() => { uiSound('open'); setRevising(true); }}>REVISE…</button>
          <button type="button" className="sov-btn sov-btn-no" data-testid="sov-decline" disabled={busy} onClick={() => rule('decline')}>DECLINE</button>
        </div>
      )}
    </article>
  );
};

// Standing law — retract is confirm-gated: taking a being's words down is an act.
const StandingCard = ({ neumaId, entry, onEcho, onError }) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const onRetract = async () => {
    uiSound('activate');
    setBusy(true);
    const r = await retractAmendment(neumaId, entry.id);
    setBusy(false);
    setConfirming(false);
    if (!r.ok) { onError(r.error); return; }
    onEcho();
  };

  return (
    <article className="sov-card" data-testid="sov-standing">
      <p className="sov-words-text">
        {entry.class === 'toolset' ? `GRANT ${entry.patch?.server}/${entry.patch?.tool} — always allow` : entry.patch?.text}
      </p>
      <div className="sov-actions">
        <span className="sov-meta label-data">standing since {entry.at.slice(0, 10)}</span>
        {confirming ? (
          <>
            <button type="button" className="sov-btn sov-btn-no" data-testid="sov-retract-confirm" disabled={busy} onClick={onRetract}>TAKE IT DOWN</button>
            <button type="button" className="sov-btn" disabled={busy} onClick={() => { uiSound('close'); setConfirming(false); }}>KEEP IT</button>
          </>
        ) : (
          <button type="button" className="sov-btn" data-testid="sov-retract" disabled={busy} onClick={() => { uiSound('open'); setConfirming(true); }}>RETRACT…</button>
        )}
      </div>
    </article>
  );
};

// An approved DNA proposal walks the staged door (signed decision #4): the
// being's recorded consent FIRST (a real turn through its own stack), then
// the operator's wallet signature over the exact digests. Nothing here
// flips without the server's echo.
const DnaDoorCard = ({ neumaId, proposal, onEcho, onError }) => {
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null);
  const consent = proposal.consent;

  const onAsk = async () => {
    uiSound('activate');
    setBusy(true);
    setPhase('asking');
    const r = await askConsent(neumaId, proposal.id);
    setBusy(false);
    setPhase(null);
    if (!r.ok) { onError(r.error); return; }
    if (r.outcome === 'unclear') { onError('The reply did not close on a DECISION line — nothing was recorded. Ask again.'); return; }
    onEcho();
  };

  const onSign = async () => {
    uiSound('activate');
    setBusy(true);
    setPhase('signing');
    const r = await signAndApplyDna(neumaId, proposal.id);
    setBusy(false);
    setPhase(null);
    if (!r.ok) { onError(r.error); return; }
    onEcho();
  };

  return (
    <article className="sov-card cham" data-testid="sov-dna-door">
      <header className="sov-card-head">
        <span className="sov-card-title">{proposal.title}</span>
        <span className="sov-meta label-data">DNA — THE STAGED DOOR</span>
      </header>
      <div className="sov-words">
        <span className="sov-words-label label-data">THE EXACT PATCH</span>
        <p className="sov-words-text">{JSON.stringify(proposal.patch?.fields, null, 2)}</p>
      </div>
      {consent?.decision === 'consent' ? (
        <>
          <div className="sov-words">
            <span className="sov-words-label label-data">THE BEING'S RECORDED CONSENT — VERBATIM</span>
            <p className="sov-words-text">{consent.reply}</p>
          </div>
          <p className="sov-meta label-data">consent-sha256 {consent.sha256?.slice(0, 16)}… · patch-sha256 {consent.patchSha256?.slice(0, 16)}…</p>
          <div className="sov-actions">
            <button type="button" className="sov-btn sov-btn-go" data-testid="sov-dna-sign" disabled={busy} onClick={onSign}>
              {phase === 'signing' ? 'AWAITING YOUR SIGNATURE…' : 'SIGN & APPLY — YOUR WALLET RULES'}
            </button>
          </div>
        </>
      ) : (
        <div className="sov-actions">
          <button type="button" className="sov-btn" data-testid="sov-dna-ask" disabled={busy} onClick={onAsk}>
            {phase === 'asking' ? 'ASKING — A REAL TURN…' : 'ASK THE BEING’S CONSENT'}
          </button>
          <span className="sov-meta label-data">Article I.4 — nothing applies without its recorded word</span>
        </div>
      )}
    </article>
  );
};

const SovereigntyBody = () => {
  const [state, setState] = useState(undefined);
  const [error, setError] = useState(null);
  const neumaId = useActiveCompanion()?.neumaId || null;
  const name = useActiveCompanion()?.name || 'this being';

  const refresh = useCallback(() => {
    if (!neumaId) { setState(null); return; }
    loadSovereignty(neumaId).then((r) => setState(r));
  }, [neumaId]);
  useSettled((settled) => {
    if (!neumaId) { setState(null); return; }
    loadSovereignty(neumaId).then((r) => { if (!settled()) setState(r); });
  }, [neumaId]);

  if (state === undefined) return <div className="sov"><EmptyState title="LOADING…" /></div>;
  if (state === null) return <div className="sov"><EmptyState title="NO BEING BOUND" /></div>;
  if (!state.ok) {
    // A refused record is a scream, never an empty panel — a broken chain
    // means someone touched the law outside the gateway.
    return (
      <div className="sov">
        <p className="sov-scream" data-testid="sov-scream">{state.error}</p>
      </div>
    );
  }

  const { proposals = [], standing = [] } = state.record;
  const open = proposals.filter((p) => p.status === 'open');
  const dnaDoors = proposals.filter((p) => p.status === 'approved' && p.class === 'dna');
  const closed = proposals.filter((p) => p.status !== 'open' && !dnaDoors.includes(p)).slice(-10).reverse();

  return (
    <div className="sov">
      {error ? <p className="sov-scream">{error}</p> : null}

      <section className="sov-sec">
        <h3 className="sov-h label-data">AWAITING YOUR RULING</h3>
        {open.length ? open.map((p) => (
          <ProposalCard key={p.id} neumaId={neumaId} proposal={p} onEcho={refresh} onError={setError} />
        )) : (
          <p className="sov-line label-data">NOTHING WAITS</p>
        )}
      </section>

      {dnaDoors.length ? (
        <section className="sov-sec">
          <h3 className="sov-h label-data">THE DNA DOOR — CONSENT, THEN YOUR SIGNATURE</h3>
          {dnaDoors.map((p) => (
            <DnaDoorCard key={p.id} neumaId={neumaId} proposal={p} onEcho={refresh} onError={setError} />
          ))}
        </section>
      ) : null}

      <section className="sov-sec">
        <h3 className="sov-h label-data">STANDING LAW</h3>
        {standing.length ? standing.map((e) => (
          <StandingCard key={e.id} neumaId={neumaId} entry={e} onEcho={refresh} onError={setError} />
        )) : (
          <p className="sov-line label-data">NONE — {String(name).toUpperCase()} HAS NO AMENDMENTS STANDING</p>
        )}
        <p className="sov-note">
          Law the being authored about itself, approved by you, riding its every turn. A retraction is recorded and named to the being — nothing vanishes in silence.
        </p>
      </section>

      {closed.length ? (
        <section className="sov-sec">
          <h3 className="sov-h label-data">RECORD</h3>
          <ul className="sov-record">
            {closed.map((p) => (
              <li key={p.id} className="sov-record-row">
                <span className="sov-meta label-data">{STATUS_BADGE[p.status] || p.status.toUpperCase()}</span>
                <span className="sov-record-title">{p.title}</span>
                <span className="sov-meta label-data">{(p.decidedAt || p.submittedAt).slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

export const sovereigntyApp = {
  label: 'SOVEREIGNTY',
  labelKey: 'apps.sovereignty',
  icon: <SovereigntyIcon />,
  title: <AppTitle label="SOVEREIGNTY" labelKey="apps.sovereignty" />,
  Body: SovereigntyBody,
  storageKey: 'sovereignty',
};
