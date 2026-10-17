// WorkflowChannel — the TEAM CHANNEL in the WORKFLOW window (Design note, 2026-10-12:
// […]). Every post the team, its lead and the operator make, oldest
// first, who to whom — and, while the team works, the operator's own word to
// everyone or to one member. A post is read when they look (the team room,
// team-channel.js); it never cuts a member's work — the steer beside each
// member is the word that does.

import { useState } from 'react';
import { postToTeam } from './team-client.js';
import { playSound } from '../../services/sound-engine.js';

const clock = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

// pure — who said it, as the operator reads it.
const speaker = (from) => (from === 'your operator' ? 'YOU' : from);

/**
 * @param {Object} props
 * @param {string} props.runId
 * @param {Array} props.channel - the posts, oldest first
 * @param {Array} props.board - the run's members ({ id, member })
 * @param {boolean} props.live - the team is working (the operator may post)
 */
export const WorkflowChannel = ({ runId, channel = [], board = [], live }) => {
  const [draft, setDraft] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!live && !channel.length) return null;
  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError('');
    const outcome = await postToTeam(runId, draft.trim(), to || null);
    setBusy(false);
    if (outcome.ok) {
      playSound('messageSent');
      setDraft('');
    } else {
      setError(outcome.error);
    }
  };
  return (
    <section className="workflow-channel" aria-label="team channel">
      <h3 className="workflow-h label-data">TEAM CHANNEL — WHAT THEY TELL EACH OTHER</h3>
      {channel.length ? (
        <ol className="workflow-channel-list">
          {channel.map((m) => (
            <li key={m.n} className={`workflow-channel-post${m.from === 'your operator' ? ' is-yours' : ''}`}>
              <span className="workflow-channel-head label-data">{clock(m.at)} · {speaker(m.from)} → {String(m.to).toUpperCase()}</span>
              <p className="workflow-channel-text">{m.text}</p>
            </li>
          ))}
        </ol>
      ) : <p className="workflow-hint label-data">NOTHING POSTED YET — MEMBERS POST WHEN A TEAMMATE NEEDS TO KNOW SOMETHING.</p>}
      {live ? (
        <div className="workflow-channel-compose">
          <select className="workflow-channel-to label-data" value={to} onChange={(e) => setTo(e.target.value)} aria-label="post to">
            <option value="">TO EVERYONE</option>
            {board.map((e) => <option key={e.id} value={e.id}>TO {String(e.member || e.id).toUpperCase()} ({e.id})</option>)}
          </select>
          <textarea
            className="workflow-steer-input"
            rows={2}
            value={draft}
            placeholder="A word to the team — they read it when they look; nobody's work is cut"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          />
          <button type="button" className="workflow-steer-send label-data" disabled={busy || !draft.trim()} onClick={send}>POST TO THE TEAM</button>
          {error ? <span className="workflow-steer-error label-data">{error}</span> : null}
        </div>
      ) : null}
    </section>
  );
};
