// QueueEntryCampaign — a queued post's place in a campaign, on its card
// (campaign plan slice 6): the GROUP it belongs to — one asset on several
// accounts — approved with one press after every copy has been read, and,
// once sent, the post's own address.
//
// A TikTok post in a group keeps its own consent: it is listed, and waits for
// its card's choices (who can watch, interactions, disclosure).

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { getPostQueue, approveQueueGroup } from '../../../services/social-channels-client.js';
import { AccountChip } from '../accounts/AccountChip.jsx';

/** The group's waiting posts as the operator will read them. Pure. */
export const groupDrafts = (queue, groupId) => (queue || []).filter((e) => e.groupId === groupId && e.status === 'draft' && !e.placeholder);

const GroupReview = ({ drafts, busy, onApprove }) => {
  const own = drafts.filter((e) => e.channelId === 'tiktok');
  const one = drafts.filter((e) => e.channelId !== 'tiktok');
  return (
    <div className="queue-group-review" data-group-review>
      {drafts.map((e) => (
        <div key={e.id} className="queue-reply-context">
          <div className="queue-preview-head"><AccountChip entry={e} /></div>
          <p className="queue-preview-text">{e.text}</p>
          {e.channelId === 'tiktok' ? <p className="settings-note">TikTok asks its own choices — approve this one on its own card.</p> : null}
        </div>
      ))}
      <button type="button" className="settings-set is-thread" disabled={busy || !one.length} onClick={() => onApprove(one)}>
        APPROVE GROUP ({one.length} {one.length === 1 ? 'POST' : 'POSTS'}){own.length ? ` · ${own.length} ON THEIR OWN CARD` : ''}
      </button>
    </div>
  );
};

/**
 * @param {{entry: object, onChanged: () => Promise<unknown>}} props
 */
export const GroupDecision = ({ entry, onChanged }) => {
  const [drafts, setDrafts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!entry.groupId || entry.status !== 'draft') return null;

  const run = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const review = () => run(async () => setDrafts(groupDrafts((await getPostQueue()).queue, entry.groupId)));
  const approve = (seen) => run(async () => {
    await approveQueueGroup(entry.groupId, Object.fromEntries(seen.map((e) => [e.id, e.text])));
    setDrafts(null);
    await onChanged();
  });

  return (
    <div className="queue-group" data-group={entry.groupId}>
      <div className="queue-entry-foot">
        <span className="queue-entry-meta" title="one asset on several accounts">GROUP {entry.groupId}</span>
        <span className="queue-entry-actions">
          <button type="button" className="settings-set" disabled={busy} onClick={drafts ? () => setDrafts(null) : review}>
            {drafts ? 'CLOSE GROUP' : 'REVIEW GROUP'}
          </button>
        </span>
      </div>
      {drafts ? <GroupReview drafts={drafts} busy={busy} onApprove={approve} /> : null}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

/** A sent post's own address, where the platform gave one. */
export const PostAddress = ({ entry }) => (entry.status === 'sent' && /^https:\/\//.test(entry.url || '') ? (
  <p className="settings-note queue-post-address">
    <a className="queue-preview-link" href={entry.url} target="_blank" rel="noreferrer">OPEN THE POST ↗</a>
  </p>
) : null);
