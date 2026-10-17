// ImageVerdict.jsx — THE OPERATOR'S EYE, where the operator is already looking.
//
// Design note, 2026-08-05: […]
//
// So the panel leads with WHAT WAS ASKED — adherence is the objectively
// checkable stratum of taste, and a verdict without the ask beside it is
// unreadable a week later. Then the being's own judgment, then the operator's.
//
// The two standings are rendered APART on purpose. The operator's grade is
// authoritative input the being weighs, not a correction applied over its
// judgment; the ledger is append-only so that is structural, and this surface
// must not undo in layout what the store guarantees in shape.
//
// Display state is a pure fold (verdict-view.js); everything here is IO.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { getImageReviews, gradeImage } from '../../../services/image-forge-client.js';
import { forgeRefOf, splitReviews, verdictLine, askedLine, VERDICTS } from './verdict-view.js';
import './ImageVerdict.css';

const Rows = ({ title, rows }) => (rows.length === 0 ? null : (
  <div className="verdict-standing">
    <span className="label-data verdict-standing-title">{title}</span>
    {rows.map((r) => (
      <div className="verdict-row" key={`${r.by}-${r.at}`}>
        <span className={`verdict-mark verdict-${r.verdict}`}>{verdictLine(r)}</span>
        {r.missing ? <span className="verdict-missing">missing: {r.missing}</span> : null}
        {r.defects ? <span className="verdict-missing">defects: {r.defects}</span> : null}
        {r.note ? <span className="verdict-note">{r.note}</span> : null}
      </div>
    ))}
  </div>
));

export const ImageVerdict = ({ item }) => {
  // Hooks run unconditionally — the guard is in the RENDER, never around them.
  const ref = useMemo(() => forgeRefOf(item), [item]);
  const [reviews, setReviews] = useState([]);
  const [asked, setAsked] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | absent
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(async (signal) => {
    if (!ref) { setState('absent'); return; }
    setState('loading');
    try {
      const body = await getImageReviews(ref.laneId, ref.imageId);
      if (signal?.aborted) return;
      setReviews(Array.isArray(body.reviews) ? body.reviews : []);
      setAsked(body.asked || null);
      setState('ready');
    } catch {
      // A file in a being's art folder that the manifest does not know is not a
      // forge render — no prompt behind it, nothing to judge adherence against.
      // The panel simply is not there, which is the honest answer.
      if (!signal?.aborted) setState('absent');
    }
  }, [ref]);

  useEffect(() => {
    const controller = new AbortController();
    setNote('');
    setError(null);
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const grade = async (verdict) => {
    if (!ref) return;
    uiSound('toggle');
    setError(null);
    try {
      await gradeImage(ref.laneId, ref.imageId, { verdict, note });
      setNote('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!ref || state === 'absent') return null;

  const { operator, own } = splitReviews(reviews);
  const askText = askedLine(asked);

  return (
    <div className="verdict">
      {/* The account SCROLLS and the act row does not. Design note, 2026-08-05: […] — a being's reading of its own work runs as long
          as it runs, and it must not push the art off the wall or put the
          operator's own verdict below the fold. */}
      <div className="verdict-scroll">
        <div className="verdict-asked">
          <span className="label-data verdict-standing-title">Asked for</span>
          <span className="verdict-asked-text">
            {askText || 'The prompt has scrolled out of the attempt log — it cannot be shown honestly.'}
          </span>
        </div>

        <Rows title={`${item.rootLabel} judged`} rows={own} />
        <Rows title="You judged" rows={operator} />
      </div>

      <div className="verdict-act">
        <input
          className="verdict-input"
          type="text"
          value={note}
          placeholder="what you see — optional"
          onChange={(e) => setNote(e.target.value)}
          aria-label="Your note on this image"
        />
        {VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            className={`gallery-act verdict-btn verdict-btn-${v}`}
            onClick={() => grade(v)}
            disabled={state === 'loading'}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>
      {error ? <span className="verdict-error label-data">{error}</span> : null}
    </div>
  );
};
