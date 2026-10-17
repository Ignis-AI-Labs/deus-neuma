// VesselLogWork — the structured session logger in the VESSEL ME lane's LOG
// section: one session title over dynamic exercise rows, each exercise a lift
// name plus a sets list (reps × weight, unit from the lane's KG/LB toggle).
// ADDS to the quick log form above it — the simple paths stay. The POST goes
// through vessel-client logVital and the lane reloads from the server (the
// server owns the truth; a 400 carries the correction on err.message).

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { logVital } from './vessel-client.js';
import { ToggleChips, UNITS } from './vessel-format.jsx';

const emptySet = () => ({ reps: '', weight: '' });
const emptyExercise = () => ({ lift: '', sets: [emptySet()] });

// pure — rows as typed → the validated wire shape. A set with reps but no
// weight rides as {reps} (bodyweight work); a set with neither drops; an
// exercise with no lift or no kept sets drops. Empty list → the form is not
// submittable (valid guards it).
const buildExercises = (rows, unit) => rows
  .map((row) => ({
    lift: row.lift.trim(),
    sets: row.sets
      .filter((s) => s.reps.trim() !== '' && Number.isFinite(Number.parseInt(s.reps, 10)))
      .map((s) => {
        const reps = Number.parseInt(s.reps, 10);
        const weight = s.weight.trim() === '' ? NaN : Number(s.weight);
        return Number.isFinite(weight) ? { reps, weight, unit } : { reps };
      }),
  }))
  .filter((row) => row.lift !== '' && row.sets.length > 0);

export const VesselLogWork = ({ unit, onUnit, defaultTitle, onLogged }) => {
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState([emptyExercise()]);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);

  // The lane's last session title is the honest default once the summary
  // lands — never overwrite a title the operator already typed.
  useEffect(() => {
    setTitle((current) => (current.trim() ? current : (defaultTitle || '')));
  }, [defaultTitle]);

  const patchExercise = (index, patch) =>
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const patchSet = (exIndex, setIndex, patch) =>
    setRows((rs) => rs.map((r, i) => (i === exIndex
      ? { ...r, sets: r.sets.map((s, j) => (j === setIndex ? { ...s, ...patch } : s)) }
      : r)));

  const exercises = buildExercises(rows, unit);
  const valid = Boolean(title.trim()) && exercises.length > 0;

  const onLog = async (event) => {
    event.preventDefault();
    if (!valid || posting) return;
    setPosting(true);
    setNote('');
    try {
      await logVital({ kind: 'session', title: title.trim(), exercises });
      uiSound('activate');
      setRows([emptyExercise()]);
      await onLogged?.();
    } catch (error) {
      setNote(error.http === 400 ? error.message : 'THE LOG REFUSED — TRY AGAIN');
    }
    setPosting(false);
  };

  return (
    <section className="vl-sec">
      <h3 className="vl-h label-data">LOG — SETS × REPS</h3>
      <form className="vl-form" onSubmit={onLog}>
        <div className="vl-form-row">
          <input className="vl-in" type="text" maxLength={120} placeholder="SESSION TITLE — E.G. PUSH DAY"
            value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} />
          <ToggleChips options={UNITS} value={unit} onPick={onUnit} ariaLabel="Unit" />
        </div>
        {rows.map((row, exIndex) => (
          <div key={exIndex} className="vl-work-ex">
            <div className="vl-form-row">
              <input className="vl-in" type="text" maxLength={60} placeholder="LIFT — E.G. BENCH PRESS"
                value={row.lift} onChange={(e) => patchExercise(exIndex, { lift: e.target.value })} spellCheck={false} />
              <button type="button" className="vl-add" disabled={rows.length === 1}
                onClick={() => { uiSound('tick'); setRows((rs) => rs.filter((_, i) => i !== exIndex)); }}
              >DROP LIFT</button>
            </div>
            {row.sets.map((set, setIndex) => (
              <div key={setIndex} className="vl-form-row">
                <span className="vl-work-tag label-data">SET {setIndex + 1}</span>
                <input className="vl-in vl-in-num" type="number" min="1" step="1" placeholder="REPS"
                  value={set.reps} onChange={(e) => patchSet(exIndex, setIndex, { reps: e.target.value })} />
                <input className="vl-in vl-in-num" type="number" min="0" step="0.5" placeholder={`WEIGHT (${unit.toUpperCase()})`}
                  value={set.weight} onChange={(e) => patchSet(exIndex, setIndex, { weight: e.target.value })} />
                <button type="button" className="vl-add" disabled={row.sets.length === 1}
                  onClick={() => {
                    uiSound('tick');
                    patchExercise(exIndex, { sets: row.sets.filter((_, j) => j !== setIndex) });
                  }}
                >DROP SET</button>
              </div>
            ))}
            <div className="vl-form-row">
              <button type="button" className="vl-add" disabled={row.sets.length >= 20}
                onClick={() => { uiSound('tick'); patchExercise(exIndex, { sets: [...row.sets, emptySet()] }); }}
              >+ SET</button>
            </div>
          </div>
        ))}
        <div className="vl-form-row">
          <button type="button" className="vl-add" disabled={rows.length >= 20}
            onClick={() => { uiSound('tick'); setRows((rs) => [...rs, emptyExercise()]); }}
          >+ LIFT</button>
          <button type="submit" className="vl-add" disabled={!valid || posting}>LOG SESSION</button>
        </div>
        {note ? <p className="vl-error label-data">{note}</p> : null}
      </form>
    </section>
  );
};
