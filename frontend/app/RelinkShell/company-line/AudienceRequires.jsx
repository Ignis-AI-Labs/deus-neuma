// AudienceRequires — the operator says what an audience REQUIRES of a company, on its own card (Design note, 2026-11-21,
// after funds that invest in nothing crypto were written to for the crypto raise: […]).
// One hard condition, proved by the company's OWN words: what must be true, the words of which one must stand on its
// own site, and the audience a company that fails it belongs to instead. It stands the moment it is saved; the next
// lead run proves every company already filed against it and moves the ones that fail.
// impure — reads the audiences and writes through the revenue routes.
import { useState } from 'react';
import { getLeadEngine, setAudienceRequired } from '../../../services/revenue-client.js';
import { announceWaitingChanged } from '../waiting/waiting-changed.js';

/** @param {{segment: object}} props - the audience, with what it requires now */
export const AudienceRequires = ({ segment }) => {
  const now = segment.required?.[0] ?? null;
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState([]);
  const [sign, setSign] = useState(now?.sign ?? '');
  const [words, setWords] = useState((now?.evidence ?? []).join(', '));
  const [otherwise, setOtherwise] = useState(now?.otherwise ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const show = async () => {
    setOpen(true);
    try { setOthers(((await getLeadEngine())?.segments ?? []).filter((s) => s.id !== segment.id && s.state !== 'retired')); } catch { /* the list of the other audiences is a help, not a need */ }
  };
  const evidence = words.split(',').map((w) => w.trim()).filter((w) => w.length >= 2);
  const save = async (required) => {
    setBusy(true); setError(null);
    try { await setAudienceRequired(segment.id, required); setOpen(false); announceWaitingChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (!open) {
    return <button type="button" className="sec-scan cline-mini label-data" data-required-open="" onClick={show}>{now ? 'CHANGE WHAT IT MUST SAY' : 'SET WHAT A COMPANY MUST SAY TO BE THIS AUDIENCE'}</button>;
  }
  return (
    <div className="cline-deal" data-required-form={segment.id}>
      <p className="cline-move-t">A HARD CONDITION, PROVED BY THE COMPANY&apos;S OWN WEBSITE. A COMPANY WHOSE SITE HOLDS NONE OF THE WORDS IS NOT THIS AUDIENCE, WHATEVER ELSE IT SCORES. THE NEXT LEAD RUN CHECKS EVERY COMPANY ALREADY FILED AND MOVES THE ONES THAT FAIL.</p>
      <div className="cline-open">
        <input className="cline-input" aria-label="What must be true of the company, in words" placeholder="what must be true (it invests in crypto, blockchain or web3 projects)" maxLength={200} disabled={busy} value={sign} onChange={(e) => setSign(e.target.value)} />
      </div>
      <div className="cline-open">
        <input className="cline-input" aria-label="The words of which one must stand on the company's own site, separated by commas" placeholder="words, one of which must be on its site: crypto, blockchain, web3, defi" disabled={busy} value={words} onChange={(e) => setWords(e.target.value)} />
        <select className="cline-input cline-deal-pick" aria-label="The audience a company that fails this belongs to instead" disabled={busy} value={otherwise} onChange={(e) => setOtherwise(e.target.value)}>
          <option value="">IF NOT: NO OTHER AUDIENCE</option>
          {others.map((s) => <option key={s.id} value={s.id}>IF NOT: {s.name}</option>)}
        </select>
      </div>
      <div className="cline-open">
        <button type="button" className="sec-scan label-data" disabled={busy || sign.trim().length < 10 || !evidence.length} data-required-save="" onClick={() => save([{ sign: sign.trim(), evidence: evidence.slice(0, 12), ...(otherwise ? { otherwise } : {}) }])}>SAVE — IT STANDS AT ONCE</button>
        {now ? <button type="button" className="sec-scan cline-danger label-data" disabled={busy} onClick={() => save([])}>REQUIRE NOTHING</button> : null}
        <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => setOpen(false)}>CANCEL</button>
      </div>
      {evidence.length > 12 ? <p className="cline-move-t" role="status">THE FIRST TWELVE WORDS ARE KEPT.</p> : null}
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
    </div>
  );
};
