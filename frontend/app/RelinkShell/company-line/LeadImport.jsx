// LeadImport — people reached through another tool, brought onto the house's own lead list (Design note, 2026-11-18, after
// Explee: […]). Choose a file — the import JSON a tool's data was
// converted to, or any CSV with an email column — and the screen first says exactly what it would do: who comes on,
// who replied with interest and waits for an answer, who said no, who goes on the do-not-contact list, who was told
// something the house does not stand behind, and who is skipped and why. IMPORT does it. impure — the file, the route.

import { useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { importLeads } from '../../../services/revenue-client.js';
import { announceWaitingChanged } from '../waiting/waiting-changed.js';
import { uiSound } from '../../../services/ui-sound.js';

const OUTCOME = Object.freeze({ interested: 'REPLIED — INTERESTED', not_interested: 'SAID NO', auto_reply: 'AUTO-REPLY', bounced: 'BOUNCED', unsubscribed: 'UNSUBSCRIBED', replied: 'REPLIED', none: 'NO REPLY' });
const OUTCOME_RANK = Object.freeze({ interested: 6, replied: 5, auto_reply: 4, none: 3, not_interested: 2, unsubscribed: 1, bounced: 0 });
const FLAG = Object.freeze({ 'told-yield-product': 'TOLD OF A PRODUCT WE DO NOT RUN', 'invented-sender': 'SIGNED BY AN INVENTED NAME' });

const Plan = ({ plan, busy, onImport }) => {
  const c = plan.counts;
  return (
    <>
      <p className="cline-move-t" data-import-plan="">
        {c.add} OF {c.people} COME ONTO THE LEAD LIST · {c.interested} REPLIED WITH INTEREST AND WAIT FOR AN ANSWER · {c.notInterested} SAID NO (CLOSED) · {c.suppress} GO ON THE DO-NOT-CONTACT LIST · {c.flagged} WERE TOLD OR SIGNED SOMETHING THE HOUSE DOES NOT STAND BEHIND · {c.skip} SKIPPED
      </p>
      <div className="cline-open">
        <button type="button" className="sec-scan label-data" disabled={busy || !c.add} aria-label={`IMPORT ${c.add} leads`} onClick={onImport}>IMPORT ({c.add})</button>
      </div>
      <Sheet label="leads to import" rows={plan.people} rowKey={(p) => p.email} rowName={(p) => p.name}
        columns={[
          { head: 'PERSON', cell: (p) => p.name },
          { head: 'ADDRESS', cell: (p) => p.email, exact: true },
          { head: 'WHAT HAPPENED', sort: (p) => OUTCOME_RANK[p.outcome] ?? null, cell: (p) => OUTCOME[p.outcome] ?? String(p.outcome).toUpperCase(), tone: (p) => (p.outcome === 'interested' ? 'on' : null) },
          { head: 'MESSAGES', sort: (p) => p.messages, cell: (p) => String(p.messages) },
          { head: 'WHAT IT DID IN OUR NAME', cell: (p) => (p.flags.length ? p.flags.map((f) => FLAG[f] ?? f).join(' · ') : null), tone: (p) => (p.flags.length ? 'alert' : null), wrap: true },
          { head: 'FROM', cell: (p) => p.source },
        ]} />
      {plan.skipped.length ? (
        <Fold id="leads:import-skipped" level={2} title="SKIPPED" stats={[`${plan.skipped.length}`]}>
          <Sheet label="skipped" rows={plan.skipped} rowKey={(s) => String(s.n)} rowName={(s) => s.who}
            columns={[{ head: 'PERSON', cell: (s) => s.who }, { head: 'ADDRESS', cell: (s) => s.email ?? null, exact: true }, { head: 'WHY', cell: (s) => s.why }]} />
        </Fold>
      ) : null}
    </>
  );
};

export const LeadImport = () => {
  const [file, setFile] = useState(null); // {name, text}
  const [plan, setPlan] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const choose = async (f) => {
    if (!f) return;
    setError(null); setDone(null); setPlan(null);
    const text = await f.text();
    setFile({ name: f.name, text });
    setBusy(true);
    try { setPlan(await importLeads(text, { dry: true })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const run = async () => {
    uiSound('activate');
    setBusy(true);
    try {
      const r = await importLeads(file.text);
      setDone({ ...r, name: file.name }); setPlan(null); setFile(null);
      announceWaitingChanged(); // the people list and the pipeline read again at once
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="cline-sec" aria-label="import leads" data-lead-import="">
      <Fold id="leads:import" title="IMPORT LEADS" waits={Boolean(plan)} stats={[done ? `${done.added} IMPORTED FROM ${done.name}` : plan ? `${plan.counts.add} READY` : 'FROM A FILE']}>
        <p className="cline-move-t">People reached through another tool come onto your lead list here, each with every message that passed, so you answer them from your own mailbox. A CSV needs an email column; nothing is written until you press IMPORT.</p>
        <input type="file" className="cline-input" accept=".json,.csv,text/csv,application/json" aria-label="Choose a file of leads to import" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} />
        {error ? <p className="sec-error" role="alert">{error}</p> : null}
        {done ? <p className="cline-move-t" role="status" data-import-done="">{done.added} IMPORTED · {done.suppressed} ON THE DO-NOT-CONTACT LIST · {done.counts.interested} WAIT FOR AN ANSWER IN REPLIES</p> : null}
        {plan ? <Plan plan={plan} busy={busy} onImport={run} /> : null}
      </Fold>
    </section>
  );
};
