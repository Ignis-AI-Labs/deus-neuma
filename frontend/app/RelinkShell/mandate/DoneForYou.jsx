// DoneForYou — every act the CMO's mandate made: what, where, when, and where
// it stands now. A live post links to the platform (delete it there); a post
// that has not left can be CANCELLED here.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { withdrawQueuePost } from '../../../services/social-channels-client.js';
import { StatusMark } from '../StatusMark.jsx';
import { feedKeyOf } from '../post-status-marks.js';

const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** @param {{rows: object[], onChanged: () => void}} props */
export const DoneForYou = ({ rows, onChanged }) => {
  const [error, setError] = useState(null);
  if (!rows.length) return <p className="mandate-empty">Nothing done under a mandate yet.</p>;
  const cancel = async (row) => {
    uiSound('toggle');
    setError(null);
    try { await withdrawQueuePost(row.queueId, 'cancelled from DONE FOR YOU'); onChanged(); } catch (err) { setError(err.message); }
  };
  return (
    <>
      {error ? <p className="settings-err" role="alert">{error}</p> : null}
      <ul className="mandate-feed" aria-label="done for you">
        {rows.map((row) => (
          <li key={row.id} className="mandate-row" data-kind={row.kind}>
            <span className="mandate-row-when">{when(row.at)}</span>
            <span className="mandate-row-what">{row.what}{row.where ? <em> · {row.where}</em> : null}</span>
            <span className="mandate-row-tag"><StatusMark status={feedKeyOf(row)} named /></span>
            {row.text ? <span className="mandate-row-text">{row.text}</span> : null}
            {row.error ? <span className="mandate-row-text is-err">{row.error}</span> : null}
            <span className="mandate-row-acts">
              {row.link ? <a href={row.link} target="_blank" rel="noreferrer">OPEN</a> : null}
              {row.canCancel ? <button type="button" onClick={() => cancel(row)}>CANCEL</button> : null}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
};
