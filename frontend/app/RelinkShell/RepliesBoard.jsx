// RepliesBoard — the queue's REPLIES section: one strip, the being's own buckets.
//
// Design note, 2026-10-13: […] UNANSWERED · STAGED ·
// ANSWERED · BIN (reply-board.js says what each holds); one search and one order serve
// whichever bucket is open. What awaits approval is never missable: STAGED opens first
// while anything is owed, and every other bucket names the count with a way there.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { binReply } from '../../services/social-channels-client.js';
import { selectReplyInbox, REPLY_BUCKETS } from '../../../core/social/reply-inbox.js';
import { AWAITING_LABEL, splitLaneIntoGroups } from './campaigns-helpers.js';
import {
  REPLY_BUCKET_LANE, REPLY_BUCKET_NOTE, awaitingReplies, openingBucket, replyBucketTotals, selectReplyAnswers,
} from './reply-board.js';
import { ReplyCandidateCard } from './ReplyCandidateCard.jsx';

const PAGE = 30;

/**
 * @param {{ lanes: {queued: Array, sent: Array, withdrawn: Array}, inbound: Array<object>,
 *   card: (entry: object) => JSX.Element, now: number, onChanged: () => Promise<void> }} props
 *   `card` renders one answer exactly as the rest of the board does.
 */
export const RepliesBoard = ({ lanes, inbound, card, now, onChanged }) => {
  // null = not picked yet: follow what is owed until the operator chooses.
  const [picked, setPicked] = useState(null);
  const [order, setOrder] = useState('newest');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const bucket = picked || openingBucket(lanes);
  const owed = awaitingReplies(lanes);
  const knocks = selectReplyInbox(inbound, { bucket: bucket === 'bin' ? 'bin' : 'unanswered', order, q, limit: shown },
    { maxLimit: Number.POSITIVE_INFINITY });
  const totals = replyBucketTotals(lanes, knocks.ok ? knocks.counts : null);
  const showKnocks = knocks.ok && (bucket === 'unanswered' || bucket === 'bin');
  const lane = REPLY_BUCKET_LANE[bucket];
  const answersAll = lane ? selectReplyAnswers(lanes[lane], { q, order }) : [];
  const answers = answersAll.slice(0, shown);
  const groups = lane ? splitLaneIntoGroups('replies', lane, answers) : [];
  const knockRows = showKnocks ? knocks.rows : [];
  const more = (showKnocks ? knocks.matched - knockRows.length : 0) + (answersAll.length - answers.length);

  const pick = (b) => { uiSound('toggle'); setPicked(b); setShown(PAGE); };

  // One act on one knock, then the board re-reads — the card moves to its new bucket.
  const act = async (postId, verb) => {
    if (busy) return;
    setBusy(postId);
    setNotice(null);
    try {
      await binReply(postId, verb);
      uiSound('toggle');
      await onChanged?.();
    } catch (err) {
      setNotice(err.message || 'That did not land.');
    } finally {
      setBusy(null);
    }
  };

  const knockCards = knockRows.map((c) => (
    <ReplyCandidateCard key={c.postId} candidate={c} now={now}>
      {c.disposition === 'none' ? (
        <button type="button" className="settings-set" disabled={busy === c.postId}
          onClick={() => act(c.postId, 'bin')}>TO BIN</button>
      ) : null}
      {c.disposition === 'dismissed' ? (
        <button type="button" className="settings-set" disabled={busy === c.postId}
          onClick={() => act(c.postId, 'restore')}>RESTORE</button>
      ) : null}
    </ReplyCandidateCard>
  ));

  return (
    <div className="replies-board">
      <div className="queue-lanes" role="tablist" aria-label="reply buckets">
        {REPLY_BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={bucket === b}
            className={`queue-lane label-data${bucket === b ? ' is-on' : ''}`}
            onClick={() => pick(b)}
          >
            {b.toUpperCase()}
            <span className="queue-lane-n">{totals[b]}</span>
          </button>
        ))}
      </div>
      <div className="settings-control reply-board-tools">
        <button
          type="button"
          className="settings-set reply-board-order"
          onClick={() => { uiSound('toggle'); setOrder(order === 'newest' ? 'oldest' : 'newest'); }}
        >
          {order === 'newest' ? 'NEWEST FIRST' : 'OLDEST FIRST'}
        </button>
        <input
          className="settings-input reply-board-search"
          type="search"
          placeholder="Search words or @handle"
          value={q}
          onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
        />
      </div>
      {bucket !== 'staged' && owed.length ? (
        <button type="button" className="settings-set reply-board-owed" onClick={() => pick('staged')}>
          {owed.length} {AWAITING_LABEL} — OPEN STAGED
        </button>
      ) : null}
      <p className="settings-note">{REPLY_BUCKET_NOTE[bucket]}</p>
      {notice ? <p className="settings-err">{notice}</p> : null}
      {knockRows.length === 0 && answers.length === 0 ? (
        <p className="settings-note">{q ? 'Nothing here matches.' : `Nothing in ${bucket.toUpperCase()}.`}</p>
      ) : null}

      {/* STAGED: the decisions stand framed at the head, the in-flight after them. */}
      {groups.map((g) => (g.key === 'awaiting' ? (
        <div key={g.key} className="queue-decisions">
          <div className="label-data queue-decisions-h">
            <span>{AWAITING_LABEL}</span>
            <span className="queue-decisions-n">{owed.length} WAITING ON YOU</span>
          </div>
          {g.entries.map(card)}
        </div>
      ) : null))}
      {knockRows.length && groups.length ? (
        <div className="label-data queue-group-h">
          REPLIES SET ASIDE<span className="queue-group-n">{knocks.matched}</span>
        </div>
      ) : null}
      {knockCards}
      {groups.filter((g) => g.key !== 'awaiting').map((g) => (
        <div key={g.key} className="queue-group">
          {g.label ? (
            <div className="label-data queue-group-h">
              {g.label}<span className="queue-group-n">{g.entries.length}</span>
            </div>
          ) : null}
          {g.entries.map(card)}
        </div>
      ))}

      {more > 0 ? (
        <div className="settings-control">
          <button type="button" className="settings-set reply-board-more"
            onClick={() => { uiSound('toggle'); setShown(shown + PAGE); }}>
            SHOW MORE
          </button>
          <span className="settings-note">{more} more</span>
        </div>
      ) : null}
    </div>
  );
};
