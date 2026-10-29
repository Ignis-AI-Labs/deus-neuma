// MandateGrantForm — granting the CMO a MANDATE is a danger act, and the
// screen says so before anything else (ruling, 2026-10-24: […]). One plain
// danger line; the choices one decision at a time (CHOKKAN) — where and how
// often, what, when it turns itself off; then the grant as marks and numbers,
// what no mandate covers, the pre-flight checks, and a red button that must
// be HELD (GrantProtocol.jsx). TikTok accounts are shown and named, never
// offered: TikTok asks for the person's yes on every post.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { grantMandate } from '../../../services/mandate-client.js';
import { TERMS, MAX_DAYS, initialGrant, grantBody, grantMarks, buttonArmed, endDateOf } from './mandate-grant-view.js';
import { useMandatePreflight } from './use-mandate-preflight.js';
import { GrantProtocol } from './GrantProtocol.jsx';

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const Toggle = ({ on, label, sub, onFlip }) => (
  <button type="button" className="mandate-toggle" aria-pressed={on} onClick={() => { uiSound('toggle'); onFlip(); }}>
    <span className="mandate-toggle-box" aria-hidden="true" />{label}{sub ? <em>{sub}</em> : null}
  </button>
);

/** @param {{view: object, act: Function, onDone: () => void}} props */
export const MandateGrantForm = ({ view, act, onDone }) => {
  const [draft, setDraft] = useState(() => initialGrant(view.accounts));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const body = grantBody(draft, timeZone());
  const checks = useMandatePreflight(body);
  const companyName = (id) => view.companies.find((c) => c.id === id)?.name || 'UNSORTED';
  const setAccount = (id, patch) => setDraft((d) => ({ ...d, accounts: { ...d.accounts, [id]: { ...d.accounts[id], ...patch } } }));
  const setAct = (k) => setDraft((d) => ({ ...d, acts: { ...d.acts, [k]: !d.acts[k] } }));
  const grant = async () => {
    uiSound('confirm');
    setBusy(true);
    setError(null);
    try { await act(() => grantMandate(body)); onDone(); } catch (err) { setError(err.message); checks.reread(); }
    setBusy(false);
  };
  const now = Date.now();
  return (
    <section className="mandate-grant is-danger" aria-label="grant a mandate">
      <p className="mandate-danger" role="alert">The CMO will post as your companies without asking you. What it posts goes public.</p>
      <p className="mandate-h">1 · WHERE IT MAY POST, AND HOW OFTEN A DAY</p>
      <ul className="mandate-accounts">
        {view.accounts.map((a) => (
          <li key={a.id}>
            {a.perPostConsent
              ? <span className="mandate-toggle is-off">{a.id}<em>{companyName(a.companyId)} · asks you on every post</em></span>
              : <Toggle on={draft.accounts[a.id]?.on} label={a.id} sub={`${companyName(a.companyId)}${a.label ? ` · ${a.label}` : ''}`} onFlip={() => setAccount(a.id, { on: !draft.accounts[a.id]?.on })} />}
            {draft.accounts[a.id]?.on ? (
              <label className="mandate-pace">
                <input type="number" min="1" max="12" value={draft.accounts[a.id].pace}
                  onChange={(e) => setAccount(a.id, { pace: Number(e.target.value) || 1 })} aria-label={`${a.id} posts a day`} /> A DAY
              </label>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mandate-h">2 · WHAT IT MAY DO</p>
      <div className="mandate-acts">
        <Toggle on={draft.acts.posts} label="POST" onFlip={() => setAct('posts')} />
        <Toggle on={draft.acts.renders} label="MAKE IMAGES AND VIDEOS" onFlip={() => setAct('renders')} />
        <Toggle on={draft.acts.replies} label="ANSWER REPLIES" sub="off unless you turn it on" onFlip={() => setAct('replies')} />
      </div>
      <p className="mandate-h">3 · TURNS ITSELF OFF AFTER</p>
      <div className="mandate-acts" role="radiogroup" aria-label="turns itself off after">
        {TERMS.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={draft.term === t.id} className="mandate-toggle"
            onClick={() => { uiSound('toggle'); setDraft((x) => ({ ...x, term: t.id })); }}>
            <span className="mandate-toggle-box" aria-hidden="true" />{t.label}
          </button>
        ))}
        <label className="mandate-pace">
          <input type="number" min="1" max={MAX_DAYS} value={draft.customDays} aria-label={`other number of days, up to ${MAX_DAYS}`}
            onChange={(e) => setDraft((x) => ({ ...x, term: 'custom', customDays: Number(e.target.value) || 1 }))} /> DAYS (UP TO {MAX_DAYS})
        </label>
        <span className="mandate-term-end">OFF ON {endDateOf(draft, now).toUpperCase()} — then everything asks you again</span>
      </div>
      <GrantProtocol
        marks={grantMarks(draft, view, now)}
        never={view.never}
        checks={checks}
        atDesk={checks.atDesk}
        armed={buttonArmed({ rows: checks.rows, atDesk: checks.atDesk, chosen: body.accounts.length })}
        busy={busy}
        onGrant={grant}
      />
      {error ? <p className="settings-err" role="alert">{error}</p> : null}
      <div className="mandate-actions">
        <button type="button" className="mandate-link" onClick={() => { uiSound('toggle'); onDone(); }}>NOT NOW</button>
      </div>
    </section>
  );
};
