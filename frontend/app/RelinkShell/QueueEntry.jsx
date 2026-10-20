// QueueEntry — one queued post's card, extracted verbatim from
// CampaignQueueSection.jsx (size-law breakdown, 2026-08-26) with its
// QueueMediaThumb and the local act() error wrapper. The section renders
// this card in both its decision block and its record; this module never
// imports CampaignQueueSection.jsx.

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import {
  isSettled, postCountFor, queueStandingLabel, queueToneOf, queueWhenLabel,
} from './campaigns-helpers.js';
import { Lightbox } from './Lightbox.jsx';
import { XPostLink } from './XPostLink.jsx';
import {
  approveQueuePost, fetchQueueMediaUrl, rejectQueuePost, removeQueuePost, withdrawQueuePost,
} from '../../services/social-channels-client.js';

// Whether an attached CARD still matches the brand it was drawn from.
//
// Design note, 2026-09-01: a queued card carried Umbrae's palette from two commits
// earlier, and this panel looked no different from one showing a current card.
// The queue stores a resolved file path and never re-renders, so a kit change
// reaches every future card and no past one.
//
// ⚠️ It FLAGS and never blocks. Approving a stale card can be exactly right —
// re-sharing something already posted — so the decision stays the witness's.
// This only refuses to let them make it blind. And only card-shaped files are
// judged at all: a badge that fires on every holiday photo is a badge nobody
// reads, which is worse than none because it looks like cover.
const KIT_MARK = Object.freeze({
  stale: { cls: 'is-stale', word: 'BRAND HAS MOVED' },
  orphaned: { cls: 'is-stale', word: 'BRAND IS GONE' },
  unrecorded: { cls: 'is-unknown', word: 'KIT NOT RECORDED' },
});

const KitMark = ({ kit }) => {
  // `current` is deliberately silent. A card that matches its brand is the
  // ordinary case, and marking the ordinary case is how a board becomes noise.
  const mark = KIT_MARK[kit?.state];
  if (!mark) return null;
  return (
    <span className={`queue-media-kit ${mark.cls}`} title={kit.note || ''}>
      {mark.word}
      {kit.note ? <em>{kit.note}</em> : null}
    </span>
  );
};

// One staged attachment, as the attachment: the REAL thumbnail (its bytes
// are fetched with auth — an <img> cannot send the Bearer header, so the
// preview route's answer becomes a local object URL, revoked on unmount)
// with the alt text beneath in the data register, or the honest [NO ALT
// TEXT] marker the queue read raises for the being. A draft is decided with
// eyes, never on a filename's say-so — and since 2026-09-01 the thumbnail
// is a DOOR: clicking it hangs the staged image full-size in the Lightbox,
// because 120px of cover-cropped thumbnail is not seeing the content the
// house is about to put out (the object URL outlives the loupe — the thumb
// stays mounted beneath it).
const QueueMediaThumb = ({ entryId, index, item }) => {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl = null;
    fetchQueueMediaUrl(entryId, index)
      .then((u) => {
        if (live) { objectUrl = u; setUrl(u); } else { URL.revokeObjectURL(u); }
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entryId, index]);
  const file = String(item.path || '').split('/').pop();
  return (
    <div className="queue-media-item">
      {url
        ? (
          <>
            <button
              type="button"
              className="queue-media-zoom"
              aria-label={`view ${file} full size`}
              onClick={() => { uiSound('toggle'); setZoomed(true); }}
            >
              <img className="queue-media-thumb" src={url} alt={item.alt || file} />
            </button>
            {zoomed ? (
              <Lightbox
                src={url}
                alt={item.alt || file}
                caption={file}
                onClose={() => setZoomed(false)}
              />
            ) : null}
          </>
        )
        : <span className="queue-media-alt">{failed ? `UNREADABLE — ${file}` : file}</span>}
      <span className={`queue-media-alt${item.alt ? '' : ' is-missing'}`}>
        {item.alt || '[NO ALT TEXT]'}
      </span>
      <KitMark kit={item.kit} />
    </div>
  );
};

// One queued post's line on the board: what it says, who staged it, where it
// stands — and the witness's decision buttons where a decision is still open.
export const QueueEntry = ({ entry, byId, roster, channels, campaigns, onChanged, onRevise, onEdit, onNotice, folded, startOpen, now }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Settled copy arrives folded: a withdrawn post's body is exactly the text
  // that should not be occupying the board (ruling, 2026-07-27). `folded` is the
  // board-wide COLLAPSE ALL; this is the per-entry override, so opening one
  // finished post does not require unfolding the whole board. The lane decides
  // the starting state — in UNAPPROVED the copy IS the work, so it opens.
  const [open, setOpen] = useState(startOpen);
  // THE THREAD'S PARENT (Kagipem 2026-07-29): a self-reply is read BENEATH
  // the post it answers — the parent's copy and its own moment ride the card.
  const parentEntry = entry.kind === 'self-reply' && entry.thread?.parentId
    ? byId?.get(entry.thread.parentId) || null
    : null;
  const parentWhen = parentEntry ? queueWhenLabel(parentEntry, now) : '';

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    onNotice?.(null);
    try {
      await fn();
    } catch (e) {
      // The refusal shows here AND at the board's head: a failed reply send
      // moves the card out of this lane on the refresh below, and an error
      // on an unmounted card is an error nobody reads.
      setError(e.message);
      onNotice?.(e.message);
    }
    // The world may have moved even when the act refused — a failed reply
    // send already recorded `failed`, an expired approval already withdrew —
    // so the board re-reads UNCONDITIONALLY (Wave-2 review: the old
    // early-return left APPROVE & SEND standing on an entry the store had
    // already settled).
    await onChanged().catch(() => {});
    setBusy(false);
  };

  const author = entry.authorNeumaId
    ? (roster.find((m) => m.neumaId === entry.authorNeumaId)?.name || entry.authorNeumaId)
    : 'you';
  const channel = channels?.find((c) => c.id === entry.channelId) || null;
  const channelName = channel?.name || entry.channelId;
  // THE ACCOUNT THIS GOES OUT ON (Design note, 2026-07-28: […]). A sent post reads who it WENT OUT as (postedAs, stamped at send);
  // everything live reads the channel's current account — never a guess.
  const accountHandle = entry.postedAs?.username || channel?.account?.username || null;
  const campaignName = entry.campaignId
    ? (campaigns?.find((c) => c.id === entry.campaignId)?.name || null)
    : null;

  // The card's register: a tone (frame + chip), the standing ATTACHED to the
  // entry's identity, one data-register meta line for time — and the post
  // shown as the POST it is, measured against the platform's own ceiling
  // (Design note, 2026-07-27: […]).
  const tone = queueToneOf(entry.status);
  const whenLabel = queueWhenLabel(entry, now);
  const count = postCountFor(entry, channel);
  const standing = (
    <span className={`queue-standing is-${tone}`}>{queueStandingLabel(entry)}</span>
  );

  // A decision that is still open NEVER folds, even under COLLAPSE ALL — a fold
  // must not hide the one thing this board exists to surface.
  const pending = entry.status === 'draft';
  const shown = pending || (open && !folded);

  // EDIT (#208) — the fix for cancel-and-restage: draft and approved copy is
  // shaped IN PLACE through the composer, which stages the update against the
  // same entry (its id, its history, its revision trail). Editing the words
  // of an approved post returns it to draft — the decision renews.
  const editButton = (
    <button type="button" className="settings-set" disabled={busy}
      onClick={() => { uiSound('toggle'); onEdit(entry); }}>
      EDIT
    </button>
  );

  // THE REPLY APPROVAL IS THE SEND (ruling, 2026-08-06): the button says so, the
  // call carries the exact copy rendered on THIS card (textSeen — the backend
  // refuses if an edit landed between render and click), and a failed send
  // surfaces its honest detail right here instead of a silent 200.
  const approve = async () => {
    if (entry.kind === 'reply') {
      const res = await approveQueuePost(entry.id, { textSeen: entry.text });
      if (res?.outcome && !res.outcome.ok) {
        throw new Error(res.outcome.detail || 'the send did not land');
      }
      return;
    }
    await approveQueuePost(entry.id);
  };

  const actions = pending ? (
    <>
      <button type="button" className="settings-set" disabled={busy}
        onClick={() => act(approve)}>
        {entry.kind === 'reply' ? 'APPROVE & SEND' : 'APPROVE'}
      </button>
      <button type="button" className="settings-set is-danger" disabled={busy}
        onClick={() => act(() => rejectQueuePost(entry.id))}>
        REJECT
      </button>
      {editButton}
    </>
  ) : (shown && entry.status === 'approved') ? (
    // Approved is LIVE copy awaiting its slot — editable (a copy edit renews
    // the decision), and WITHDRAWABLE: pulling armed copy back is the
    // operator's own act (until 2026-08-06 only beings and the system could
    // withdraw), distinct from rejecting a draft.
    <>
      {editButton}
      <button type="button" className="settings-set is-danger" disabled={busy}
        onClick={() => act(() => withdrawQueuePost(entry.id))}>
        WITHDRAW
      </button>
    </>
    /* Copy that is finished but never reached anyone — declined, withdrawn,
       or failed — can come BACK as a fresh draft, or be cleared away. Sent
       copy gets neither: re-staging it is how you post the same thing twice.
       Design note, 2026-07-27: […]
       The old record is never edited — the rejection stands, and the revision
       is a new draft beside it, so the history says what actually happened.
       A REPLY is never revised through the composer — a fresh answer is the
       being's to stage, with the exchange in front of it. */
  ) : (shown && isSettled(entry.status) && entry.status !== 'sent') ? (
    <>
      {entry.kind !== 'reply' ? (
        <button type="button" className="settings-set" disabled={busy}
          onClick={() => { uiSound('toggle'); onRevise(entry); }}>
          REVISE
        </button>
      ) : null}
      <button type="button" className="settings-set is-danger" disabled={busy}
        onClick={() => act(() => removeQueuePost(entry.id))}>
        REMOVE
      </button>
    </>
  ) : null;

  return (
    <div className={`queue-card cham is-${tone}`}>
      <div className="cham-in queue-card-in">
        <button
          type="button"
          className="queue-entry-head"
          aria-expanded={shown}
          onClick={() => { uiSound('toggle'); setOpen(!shown); }}
        >
          <span className="queue-entry-id">
            <span className="settings-k">
              {channelName}{accountHandle ? ` @${accountHandle}` : ''} · {author}
            </span>
            {standing}
          </span>
          <span className="settings-v"><span className="settings-sec-tags">
            {entry.kind === 'reply' ? <span className="settings-tag-dim">REPLY</span> : null}
            {entry.kind === 'self-reply' ? <span className="settings-tag-dim">THREAD</span> : null}
            {campaignName ? <span className="settings-tag-dim">{campaignName}</span> : null}
            {pending ? null : <span className="settings-tag-dim">{shown ? '−' : '+'}</span>}
          </span></span>
        </button>
        {shown ? (
          // The post as the POST it is — the operator judges copy, not a
          // paragraph: who speaks, the words as they will read, and the
          // platform's own measure underneath.
          <div className="queue-preview">
            {entry.kind === 'reply' && entry.reply ? (
              // THE EXCHANGE (ruling, 2026-07-28): a reply is never approved
              // blind — what was said TO the house sits above the drafted
              // answer, verbatim, with its verification standing named
              // HONESTLY (unverified authors are answerable now — the
              // standing is a signal, never a gate) and its escalation
              // category raised when the words need care.
              <div className="queue-reply-context">
                <div className="queue-preview-head">
                  {/* THE LINK BACK (ruling, 2026-08-28): the operator verifies
                      who the house is answering MANUALLY — the quoted post's
                      author opens the real post on X, from the id the queue
                      already persisted, on drafts and in the sent record. */}
                  <XPostLink postId={entry.reply.toPostId} className="queue-preview-author">
                    @{entry.reply.toUsername || 'unknown'}
                  </XPostLink>
                  <span className="queue-preview-via">
                    {entry.reply.toVerifiedType ? `VERIFIED · ${String(entry.reply.toVerifiedType).toUpperCase()}` : 'UNVERIFIED'} · REPLIED TO THE HOUSE
                  </span>
                  {entry.reply.category && entry.reply.category !== 'ordinary' ? (
                    <span className={`queue-preview-via${['financial', 'legal', 'threat'].includes(entry.reply.category) ? ' is-alert' : ''}`}>
                      {String(entry.reply.category).toUpperCase()}
                    </span>
                  ) : null}
                </div>
                <p className="queue-preview-text">{entry.reply.toTextPreview}</p>
              </div>
            ) : null}
            {entry.kind === 'self-reply' && parentEntry ? (
              // THE THREAD (Kagipem 2026-07-29): a follow-up is never
              // decided blind — the PARENT it answers sits above the copy,
              // verbatim, with the parent's own moment named (its schedule
              // if it stands, SENT if it already went).
              <div className="queue-reply-context">
                <div className="queue-preview-head">
                  <span className="queue-preview-via">
                    FOLLOWS THE PARENT{parentWhen ? ` · ${parentWhen}` : ''}
                  </span>
                </div>
                <p className="queue-preview-text">{parentEntry.text}</p>
              </div>
            ) : null}
            <div className="queue-preview-head">
              <span className="queue-preview-author">{author}</span>
              <span className="queue-preview-via">
                {accountHandle ? `@${accountHandle} · ` : ''}{entry.kind === 'reply' ? `${channelName} · ANSWERS` : channelName}
              </span>
            </div>
            <p className="queue-preview-text">{entry.text}</p>
            {entry.media?.length ? (
              // The attachments themselves — the witness decides the images,
              // not a MEDIA ×N count. Each thumbnail is the real staged file
              // behind the authenticated preview route.
              <div className="queue-media">
                {entry.media.map((item, i) => (
                  <QueueMediaThumb key={`${entry.id}-${i}`} entryId={entry.id} index={i} item={item} />
                ))}
              </div>
            ) : null}
            <div className="queue-preview-foot">
              {/* The spacer keeps the count right-aligned, as it was when the
                  meta line carried text. */}
              <span className="queue-entry-meta" />
              <span className={`queue-preview-count${count.over ? ' is-over' : ''}`}>
                {count.count}{count.limit !== null ? ` / ${count.limit}` : ''}
              </span>
            </div>
          </div>
        ) : (
          // Folded still shows the first line, so the board reads as an index
          // of what is there rather than a stack of anonymous rows.
          <p className="settings-note queue-entry-peek">
            {entry.text.length > 90 ? `${entry.text.slice(0, 90)}…` : entry.text}
          </p>
        )}
        {(whenLabel || actions) && (pending || shown) ? (
          <div className="queue-entry-foot">
            <span className="queue-entry-meta">
              {whenLabel}
              {entry.status === 'failed' && entry.error ? ` — ${entry.error}` : ''}
            </span>
            {actions ? <span className="queue-entry-actions">{actions}</span> : null}
          </div>
        ) : null}
        {error ? <p className="settings-err">{error}</p> : null}
      </div>
    </div>
  );
};
