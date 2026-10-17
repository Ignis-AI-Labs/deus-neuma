// WorkflowSteer — the operator's channel to ONE member of a working team
// (Design note, 2026-10-10: […]). A member that is working is paused and CONTINUES its part with
// the note — its work so far stands (team-part.js); a member still waiting
// reads it when it starts. The button says which will happen before it is
// pressed.

import { useState } from 'react';
import { steerTeamMember } from './team-client.js';
import { playSound } from '../../services/sound-engine.js';

/**
 * @param {Object} props
 * @param {string} props.runId
 * @param {Object} props.entry - the board entry ({ id, member, state })
 * @param {Array} props.notes - the guidance already given ({ note, at })
 */
export const WorkflowSteer = ({ runId, entry, notes = [] }) => {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const working = entry.state === 'working';
  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError('');
    const outcome = await steerTeamMember(runId, entry.id, draft.trim());
    setBusy(false);
    if (outcome.ok) {
      playSound('messageSent');
      setDraft('');
    } else {
      setError(outcome.error);
    }
  };
  return (
    <section className="workflow-steer">
      <h4 className="workflow-h label-data">YOUR GUIDANCE TO {String(entry.member || entry.id).toUpperCase()}</h4>
      {notes.length ? (
        <ol className="workflow-steer-notes">
          {notes.map((n, i) => <li key={`${n.at}-${i}`} className="workflow-steer-note">{n.note}</li>)}
        </ol>
      ) : null}
      <textarea
        className="workflow-steer-input"
        rows={2}
        value={draft}
        placeholder={working ? 'Guide this member — it continues its part with your note' : 'Guide this member — your note joins its brief'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
      />
      <button type="button" className="workflow-steer-send label-data" disabled={busy || !draft.trim()} onClick={send}>
        {working ? 'SEND — IT CONTINUES WITH THIS' : 'SEND — ADD TO ITS BRIEF'}
      </button>
      {error ? <span className="workflow-steer-error label-data">{error}</span> : null}
    </section>
  );
};
