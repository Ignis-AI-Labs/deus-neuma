// VesselDailies — the DAILIES board of the ME lane: the operator's daily
// workouts as today's chips (tap = logged complete, at their word), and the
// EDIT mode that writes a new `dailies-set` snapshot to the vitals log. The
// streak tile above counts a day only when every chip lands — the server
// owns that law (core/vessel/dailies.js); this board only logs and refetches.
//
// Two roads past the plain tap (Design note, 2026-09-02 — a day done but never marked
// cost him nothing only because the record could still take it):
//   · PROOF — an optional line that rides the next mark ([…]: a photo, a watch reading, a name), stored as the entry's
//     note.
//   · MISSED A DAY? — chips re-aim at a picked past day; the stamp lands at
//     local noon (day certain, time approximate) and recordedAt keeps the
//     honest moment of the logging. The word-law is unchanged.
//
// REST DAY (Design note, 2026-09-05 — recovery the streak honors: a few days a
// month (≤4, ≥2 training days between) claimed at his word; the day counts,
// marked honestly as rest. The server owns the law and answers a refused
// claim in plain words; a second tap confirms, because a misclick should not
// spend a rest day.
//
// The honor line is the product stance, said where the streak lives (Founder,
// 2026-08-28): the record runs on the operator's word, and a padded streak
// serves no one — the body shows the truth either way.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { logVital } from './vessel-client.js';

// Local calendar days, for the missed-a-day road: the streak law judges by
// the LOCAL day (core/time/day-key.js), so the picker speaks local dates and
// the stamp lands at local noon — day certain, time approximate, the same
// doctrine the log's restorations already carry.
const localDayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return localDayKey(d); };

export const VesselDailies = ({ dailies, onChanged }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [newTitle, setNewTitle] = useState('');
  const [proof, setProof] = useState('');
  const [pastDay, setPastDay] = useState(''); // '' = marking today
  const [confirmRest, setConfirmRest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const restLeft = dailies?.restDaysLeft ?? 0;

  const takeRestDay = async () => {
    if (busy) return;
    if (!confirmRest) { uiSound('open'); setConfirmRest(true); return; }
    uiSound('activate');
    setBusy(true);
    setErr('');
    try {
      await logVital({ kind: 'rest-day' });
      await onChanged();
    } catch (error) {
      setErr(error.http === 400 ? error.message : 'THE LOG REFUSED — TRY AGAIN');
    }
    setConfirmRest(false);
    setBusy(false);
  };

  const openEditor = () => {
    uiSound('toggle');
    setDraft((dailies?.items ?? []).map((i) => ({ id: i.id, title: i.title })));
    setNewTitle('');
    setErr('');
    setEditing(true);
  };

  const addDraft = () => {
    const title = newTitle.trim();
    if (!title) return;
    setDraft([...draft, { title }]); // no id — the server mints one
    setNewTitle('');
  };

  const saveDraft = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const items = newTitle.trim() ? [...draft, { title: newTitle.trim() }] : draft;
      await logVital({ kind: 'dailies-set', items });
      uiSound('activate');
      setEditing(false);
      setNewTitle('');
      await onChanged();
    } catch (error) {
      setErr(error.http === 400 ? error.message : 'THE LOG REFUSED — TRY AGAIN');
    }
    setBusy(false);
  };

  const complete = async (item) => {
    if (busy) return;
    if (!pastDay && item.done) return;
    uiSound('toggle');
    setBusy(true);
    setErr('');
    try {
      const fields = { kind: 'daily', dailyId: item.id };
      // The proof-of-work line rides the mark when the operator wrote one.
      if (proof.trim()) fields.note = proof.trim();
      // A day done but never marked: stamp the day it happened (local noon);
      // recordedAt on the server keeps the honest moment of the logging.
      if (pastDay) fields.occurredAt = new Date(`${pastDay}T12:00:00`).toISOString();
      await logVital(fields);
      setProof('');
      await onChanged();
    } catch (error) {
      setErr(error.http === 400 ? error.message : 'THE LOG REFUSED — TRY AGAIN');
    }
    setBusy(false);
  };

  return (
    <section className="vl-sec">
      <h3 className="vl-h label-data">
        DAILIES{dailies ? ` — ${dailies.done}/${dailies.total} TODAY` : ''}
      </h3>
      {!editing && dailies ? (
        dailies.resting ? (
          <p className="vl-quiet label-data" data-testid="rest-day-now">
            REST DAY — RECOVERY IS PART OF THE PRACTICE. THE STREAK HOLDS;
            NOTHING IS ASKED OF THE BODY TODAY. {restLeft} OF 4 REST DAYS LEFT THIS MONTH.
          </p>
        ) : (
          <>
            {pastDay ? (
              <p className="vl-quiet label-data">
                MARKING {pastDay} — TAP EACH DAILY THAT LANDED. THE RECORD KEEPS BOTH STAMPS:
                THE DAY IT HAPPENED AND THE MOMENT YOU LOGGED IT.
              </p>
            ) : null}
            <div className="vl-chips" role="group" aria-label={pastDay ? `Dailies for ${pastDay}` : "Today's dailies"}>
              {dailies.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`vl-chip${!pastDay && item.done ? ' is-on' : ''}`}
                  aria-pressed={pastDay ? false : item.done}
                  disabled={busy}
                  onClick={() => complete(item)}
                >{item.title.toUpperCase()}</button>
              ))}
              <button type="button" className="vl-chip" onClick={openEditor}>EDIT</button>
            </div>
            <div className="vl-form-row">
              <input
                className="vl-in" type="text" maxLength={280}
                placeholder="PROOF OF THE WORK — OPTIONAL, RIDES THE NEXT MARK"
                aria-label="Proof of the work (optional)"
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                spellCheck={false}
              />
              {pastDay ? (
                <>
                  <input
                    className="vl-in" type="date"
                    aria-label="The day the work happened"
                    value={pastDay} max={localDayKey(new Date())}
                    onChange={(e) => setPastDay(e.target.value)}
                  />
                  <button type="button" className="vl-chip" onClick={() => { setPastDay(''); setErr(''); }}>BACK TO TODAY</button>
                </>
              ) : (
                <>
                  <button type="button" className="vl-chip" onClick={() => { uiSound('toggle'); setPastDay(yesterdayKey()); }}>MISSED A DAY?</button>
                  <button
                    type="button" className="vl-chip" data-testid="rest-day-take"
                    disabled={busy || restLeft <= 0}
                    title={restLeft <= 0 ? 'No rest days left this month' : 'Recovery counts — the streak holds'}
                    onClick={takeRestDay}
                  >{confirmRest ? `CONFIRM — ${restLeft} LEFT` : 'REST DAY?'}</button>
                </>
              )}
            </div>
          </>
        )
      ) : null}
      {!editing && !dailies ? (
        <div className="vl-chips" role="group" aria-label="Dailies setup">
          <button type="button" className="vl-chip" onClick={openEditor}>SET UP DAILIES</button>
        </div>
      ) : null}
      {editing ? (
        <div className="vl-form">
          {draft.length > 0 ? (
            <ul className="vl-lines">
              {draft.map((item, index) => (
                <li key={item.id ?? `new-${index}`} className="vl-line">
                  <span className="vl-line-main">{item.title}</span>
                  <button
                    type="button"
                    className="vl-chip"
                    aria-label={`Remove ${item.title}`}
                    onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                  >✕</button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="vl-form-row">
            <input
              className="vl-in" type="text" maxLength={60}
              placeholder="DAILY — E.G. PRE-DESK 15 MIN"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } }}
              spellCheck={false}
            />
            <button type="button" className="vl-add" onClick={addDraft} disabled={!newTitle.trim()}>ADD</button>
          </div>
          <div className="vl-form-row">
            <button type="button" className="vl-add" onClick={saveDraft} disabled={busy}>SAVE</button>
            <button type="button" className="vl-chip" onClick={() => { setEditing(false); setErr(''); }}>CANCEL</button>
          </div>
        </div>
      ) : null}
      {err ? <p className="vl-error label-data">{err}</p> : null}
      <p className="vl-quiet label-data">
        LOGGED AT YOUR WORD — A DAY COUNTS WHEN EVERY DAILY LANDS, OR WHEN YOU
        CLAIMED IT AS REST. A PADDED STREAK SERVES NO ONE; THE BODY SHOWS THE
        TRUTH EITHER WAY.
      </p>
    </section>
  );
};
