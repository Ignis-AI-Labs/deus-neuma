// StreamPanel — the consciousness stream, rendered.
//
// Messages flow top to bottom; the live neuma message carries a cursor.
// History (loaded on relink) sits above a SESSION RESUMED divider so a
// returning witness picks up where they left off. Auto-scrolls to the
// tail as content arrives.

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ToolChip } from './ToolChip.jsx';
import { ThoughtBubble } from './ThoughtBubble.jsx';
import { ApprovalChip } from './ApprovalChip.jsx';
import { AskChip } from './AskChip.jsx';
import { PlanChip } from './PlanChip.jsx';
import { SealChip } from './SealChip.jsx';
import { TeamRunChip } from './TeamRunChip.jsx';
import { StreamingSpeech } from './StreamingSpeech.jsx';
import { uiSound } from '../../services/ui-sound.js';
import { useTextZoom } from './use-text-zoom.js';
import { atTail } from './stream-follow.js';
import { CopyWord, speechText } from './copy-word.jsx';
import { formatClockStamp } from '../../utils/format.js';
import { HistoryImage } from './HistoryImage.jsx';
import { useStreamWindow } from './use-stream-window.js';
import { StreamFollow } from './StreamFollow.jsx';
import { CompactMarker } from './CompactMarker.jsx';
import { QueuedWordDoors, newestHoldId } from './QueuedWordDoors.jsx';

// The witness's own words render verbatim (pre-wrap keeps their line breaks
// and never reinterprets them as markdown); the consciousness's speech goes
// through StreamingSpeech — a paced live reveal that renders instantly for
// completed/history messages.
const Segment = ({ segment, role, live, onApprove, onAsk, onPlan, onSeal, onReveal }) => {
  // One kind, one renderer. The chain grew past readable when the thought
  // bubble joined it — a lookup keeps every new segment kind a one-line change.
  switch (segment.kind) {
    // Reasoning: watchable, folded shut, never speech.
    case 'thought': return <ThoughtBubble segment={segment} live={live} />;
    case 'tool': return <ToolChip segment={segment} />;
    case 'approval': return <ApprovalChip segment={segment} onRespond={onApprove} />;
    case 'ask': return <AskChip segment={segment} onRespond={onAsk} />;
    case 'plan': return <PlanChip segment={segment} onRespond={onPlan} />;
    case 'seal': return <SealChip segment={segment} onRespond={onSeal} />;
    case 'teamrun': return <TeamRunChip segment={segment} />;
    case 'image': return <HistoryImage segment={segment} />;
    case 'doc': return (
      <span className="relink-msg-doc label-data" title={`shared file: ${segment.name}`}>{segment.name}</span>
    );
    default: return role === 'user'
      ? <div className="relink-md relink-md--verbatim">{segment.text}</div>
      : <StreamingSpeech text={segment.text} live={live} onReveal={onReveal} />;
  }
};

const MessageMeta = ({ meta }) => {
  const memories = meta.memoriesUsed?.length || 0;
  // The tag is the being's DECLARED affect or nothing (Campaign 6, Founder-
  // signed: revelation or silence, never a keyword guess dressed as one —
  // meta.emotion still rides the frame for the vessel, but never renders).
  if (!meta.affect && !memories && !meta.interrupted) return null;
  return (
    <div className="relink-meta">
      {meta.affect ? <span className="relink-affect">{meta.affect}</span> : null}
      {memories ? <span className="relink-memories">{memories} memories referenced</span> : null}
      {meta.interrupted ? <span className="relink-interrupted">{meta.queuedHandoff ? 'continued with queued message' : 'interrupted'}</span> : null}
    </div>
  );
};

// The editor's own acts (SAVE / CANCEL) stay in view as it opens and grows —
// a box that grew past the transcript's bottom edge hid them. Only the
// transcript scrolls: scrollIntoView would walk (and scroll) the ancestors.
const keepInStream = (el) => {
  const stream = el?.closest('.relink-stream');
  if (!stream) return;
  const over = el.getBoundingClientRect().bottom - stream.getBoundingClientRect().bottom;
  if (over > 0) stream.scrollTop += over + 8;
};

const MessageView = ({ message, onEdit, onRevise, onRetry, onTakeSwitch, onApprove, onAsk, onPlan, onSeal, onReveal, onQueueEdit, onQueueNow, escTakesBack = false }) => {
  // THE EDIT, WHERE THE MESSAGE STANDS (Design note, 2026-07-28: […]). EDIT opens the editor AT the bubble; SAVE re-sends
  // the revised words FROM this point — the edit-fork, a new take, its own
  // chain forward ([…]) — and CANCEL restores. The composer is
  // never involved. A legacy row carries no point to fork from; its SAVE
  // falls back to the composer recall, the only road left to it.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // THE BOX FITS THE WORDS (Design note, 2026-07-28: […]):
  // the field grows with the draft — never an inner scrollbar inside a
  // two-row shoebox while the message wraps four lines. auto-then-measure
  // is the honest fit; the CSS max-height is where scrolling begins.
  const editFieldRef = useRef(null);
  const editActionsRef = useRef(null);
  useLayoutEffect(() => {
    const field = editFieldRef.current;
    if (!editing || !field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
    keepInStream(editActionsRef.current);
  }, [editing, draft]);

  const cls = [
    'relink-msg',
    `relink-msg--${message.role}`,
    message.isHistory ? 'is-history' : '',
    message.streaming ? 'is-streaming' : '',
    message.transient ? 'is-transient' : '',
    // A word the portal still HOLDS — visibly waiting, and still the
    // operator's to rewrite, promote, or pull home (ruling, 2026-08-16).
    message.queued ? 'is-queued' : '',
    // Editing stretches the bubble to the stream's width — the bubble's own
    // shrink-to-fit column is right for a spoken line, wrong for an editor.
    editing ? 'is-editing' : '',
  ].filter(Boolean).join(' ');

  // The witness's own words can be revised at the source — a mistake gets
  // corrected where it stands instead of patched downstream.
  const editable = message.role === 'user' && (onRevise || onEdit);
  const spokenText = editable
    ? message.segments.filter((s) => s.kind !== 'tool').map((s) => s.text || '').join('')
    : '';

  const openEdit = () => {
    uiSound('tick');
    setDraft(spokenText);
    setEditing(true);
  };
  const saveEdit = () => {
    if (!draft.trim() || draft === spokenText) return;
    uiSound('activate');
    setEditing(false);
    // A HELD word saves back into the queue — it still goes at the turn's
    // end, just with the revised words. Only a delivered word forks a take.
    if (message.queued && message.holdId && onQueueEdit) {
      onQueueEdit({ holdId: message.holdId, text: draft });
    } else if (message.turnId && onRevise) onRevise({ turnId: message.turnId, text: draft });
    else onEdit?.({ text: draft, turnId: null });
  };

  // WHEN it was said — the time alone for today's words, the date joined on
  // for another day's, so a returning witness can track the conversation.
  // A live message waits for its stamp (it would just read "now", growing).
  const when = message.streaming ? '' : formatClockStamp(message.at);

  return (
    <div className={cls}>
      {when ? <div className="relink-msg-when label-data">{when}</div> : null}
      <div className="relink-msg-body">
        {editing ? (
          <div className="relink-inline-edit">
            <textarea
              ref={editFieldRef}
              className="relink-inline-edit-field"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Escape stands the editor down (and never walks the field's
                // own Escape ladder); ⌘/Ctrl+Enter saves.
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); }
              }}
            />
            <div ref={editActionsRef} className="relink-inline-edit-actions label-data">
              <button
                type="button"
                className="relink-inline-save"
                disabled={!draft.trim() || draft === spokenText}
                title={message.queued
                  ? 'Rewrite the held word — it still goes after the current action finishes'
                  : message.turnId
                    ? 'Send the revised words from this point — the conversation continues from here'
                    : 'This message carries no point — the words go to the composer instead'}
                onClick={saveEdit}
              >
                {message.queued ? 'SAVE — STILL QUEUED' : 'SAVE — CONTINUE FROM HERE'}
              </button>
              <button
                type="button"
                className="relink-inline-cancel"
                onClick={() => { uiSound('tick'); setEditing(false); }}
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.segments.map((s, i) => {
              // Only trailing speech is paced. Once an action follows speech, its
              // key flips to settled so React remounts it fully revealed in the
              // same commit that exposes the action.
              const live = message.streaming
                && (s.kind === 'speech' || s.kind === 'thought')
                && i === message.segments.length - 1;
              return <Segment key={`${i}:${live ? 'live' : 'settled'}`} segment={s} role={message.role} live={live} onApprove={onApprove} onAsk={onAsk} onPlan={onPlan} onSeal={onSeal} onReveal={onReveal} />;
            })}
            {message.streaming ? <span className="relink-cursor" aria-hidden="true" /> : null}
          </>
        )}
      </div>
      {message.meta ? <MessageMeta meta={message.meta} /> : null}
      {message.role === 'error' && message.reason ? <div className="relink-msg-reason label-data">{message.reason}</div> : null}
      {/* COPY on every settled message — the spoken words, paste-ready
          anywhere; EDIT stays the witness's own-words affordance.
          THE TAKES ride here too: ‹ k/N › walks a point's versions (an
          append-only view fact, never a rewrite of the record) and ↻ asks
          the point again as take N+1 — offered on ANY settled message that
          carries a turn-point (answer, the witness's own bubble, or a
          persisted failure), because a retry opens a new chain from THAT
          point and the later turns follow the view. Take navigation stays
          the answer's — the takes belong to it. */}
      {!message.streaming && !editing ? (
        <div className="relink-msg-actions">
          {/* A held word's doors (QueuedWordDoors.jsx): QUEUED, SEND NOW, and Escape's hint. */}
          {message.queued && message.holdId ? (
            <QueuedWordDoors holdId={message.holdId} onQueueNow={onQueueNow} escTakesBack={escTakesBack} />
          ) : null}
          {message.role === 'neuma' && message.turnId ? (
            <span className="stream-takes label-data">
              {message.takeCount > 1 ? (
                <>
                  <button
                    type="button"
                    className="stream-take-step"
                    disabled={message.takeIndex <= 1}
                    title="View the previous take of this answer"
                    onClick={() => { uiSound('tick'); onTakeSwitch?.(message.turnId, message.takeIndex - 1); }}
                  >
                    ‹
                  </button>
                  <span className="stream-take-pos">{message.takeIndex}/{message.takeCount}</span>
                  <button
                    type="button"
                    className="stream-take-step"
                    disabled={message.takeIndex >= message.takeCount}
                    title="View the next take of this answer"
                    onClick={() => { uiSound('tick'); onTakeSwitch?.(message.turnId, message.takeIndex + 1); }}
                  >
                    ›
                  </button>
                </>
              ) : null}
              {onRetry ? (
                <button
                  type="button"
                  className="stream-retry"
                  title="Ask this point again — another take of the same answer"
                  onClick={() => { uiSound('activate'); onRetry(message.turnId); }}
                >
                  ↻
                </button>
              ) : null}
            </span>
          ) : null}
          {/* ↻ on the witness's own bubble and on a persisted failure — the
              point is named on both, and a retry from either continues the
              conversation FROM that point. No turnId (a legacy row, a
              pre-persist refusal) offers nothing: there is no point to ask. */}
          {(message.role === 'user' || message.role === 'error') && message.turnId && onRetry ? (
            <span className="stream-takes label-data">
              <button
                type="button"
                className="stream-retry"
                title={message.role === 'user'
                  ? 'Ask from this point again — the conversation continues from here'
                  : 'Ask this point again — the failure left it on the record'}
                onClick={() => { uiSound('activate'); onRetry(message.turnId); }}
              >
                ↻
              </button>
            </span>
          ) : null}
          <CopyWord text={speechText(message.segments)} />
          {editable ? (
            <button
              type="button"
              className="relink-edit"
              // THE EDIT, IN PLACE: the bubble itself becomes the editor —
              // the words never leave for the composer. SAVE forks from this
              // point (a new take, its own chain); a legacy row without a
              // point falls back to the composer recall inside saveEdit.
              onClick={openEdit}
              title="Edit this message where it stands — the conversation continues from your revised words"
            >
              EDIT
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

// A WATCH the chat set, reporting — the platform's line, never the operator's
// bubble (chat-watch.js): drawn as an event, and the being's answer follows.
// A HOUSE WAKE's opening note (house-clock/wake-thought.js) is the same kind of
// line: the platform woke the seat for its own work, not the operator.
const PLATFORM_LINES = Object.freeze({
  watch: Object.freeze({ tag: 'WATCH', head: /^\[A WATCH YOU SET[^\]]*\]\s*/ }),
  wake: Object.freeze({ tag: 'WAKE', head: /^\[A WAKE[^\]]*\]\s*/ }),
});
const WatchLine = ({ message }) => (
  <div className="relink-watch-line" role="status">
    <span className="relink-watch-tag label-data">{PLATFORM_LINES[message.role].tag}</span>
    <span className="relink-watch-text">{message.segments.map((s) => s.text || '').join('').replace(PLATFORM_LINES[message.role].head, '')}</span>
  </div>
);

const Message = memo((props) => (PLATFORM_LINES[props.message.role] ? <WatchLine message={props.message} /> : <MessageView {...props} />));

const ThinkingIndicator = () => (
  <div className="relink-thinking" aria-label="The consciousness is reaching">
    <span className="relink-thinking-dot" />
    <span className="relink-thinking-dot" />
    <span className="relink-thinking-dot" />
  </div>
);

export const StreamPanel = ({ messages, thread, thinking, connected, onEdit, onRevise, onRetry, onTakeSwitch, onApprove, onAsk, onPlan, onSeal, onQueueEdit, onQueueNow }) => {
  // Ctrl+scroll zooms the STREAM's text only (Ctrl+0 over it resets) —
  // per-surface, remembered, clamped legible-to-sane. Other surfaces may
  // opt in with their own key; the desk chrome never scales.
  const { ref: zoomRef, style: zoomStyle } = useTextZoom('stream');
  // Escape's first tap pulls the NEWEST held word (StreamInput), so only that bubble says so.
  const escHoldId = newestHoldId(messages);

  // The follow law (stream-follow.js): snap to the tail by default, release
  // when the witness scrolls up to read — a human reads at reading speed —
  // re-arm when they return to the tail (or take the LIVE control).
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  followingRef.current = following;
  useEffect(() => { setFollowing(true); }, [thread]);

  // The paced reveal grows the message between reducer updates — keep the
  // tail in view as characters appear, same follow the chunk path has.
  // Scroll the transcript itself instead of scrollIntoView, which also walks
  // and measures ancestor scrollers.
  const follow = useCallback(() => {
    const stream = zoomRef.current;
    if (followingRef.current && stream) stream.scrollTop = stream.scrollHeight;
  }, [zoomRef]);

  // A long chat draws its recent tail first (use-stream-window.js).
  const { start, sentinelRef, showEarlier } = useStreamWindow({
    length: messages.length, thread, scroller: zoomRef, following,
  });

  // The divider marks the moment of reconnection — after the last history
  // message, whether or not a live turn has arrived yet.
  let lastHistoryIdx = -1;
  messages.forEach((m, i) => { if (m.isHistory) lastHistoryIdx = i; });

  const isEmpty = messages.length === 0 && !thinking;
  const showThinking = thinking && !messages.some((m) => m.streaming);

  // Structural tail changes (new message, tool/card, completion) need one
  // follow after commit. Speech-text growth is intentionally absent here:
  // StreamingSpeech follows each committed reveal frame itself, so network
  // chunks do not trigger a redundant layout against unchanged visible text.
  const tail = messages.at(-1);
  const tailSegment = tail?.segments.at(-1);
  const tailStructure = [
    tail?.id || '', messages.length, tail?.segments.length || 0,
    tailSegment?.kind || '', tailSegment?.phase || '', tail?.streaming ? 1 : 0,
  ].join(':');
  const tailAction = tailSegment?.kind === 'speech' ? null : tailSegment;
  useLayoutEffect(() => {
    if (following) follow();
  }, [tailStructure, tailAction, thinking, following, follow]);
  const announcement = tail && !tail.streaming && (tail.role === 'neuma' || tail.role === 'error')
    ? speechText(tail.segments)
    : '';

  return (
    // The frame holds the transcript and, under it, the follow control's own
    // lane (StreamFollow) — the control never floats over the words.
    <div className="relink-stream-frame">
      <div
        className={isEmpty ? 'relink-stream is-empty' : 'relink-stream'}
        role="log"
        aria-label="Consciousness transcript"
        aria-live="off"
        aria-busy={thinking || Boolean(tail?.streaming)}
        ref={zoomRef}
        style={zoomStyle}
        onScroll={(e) => setFollowing(atTail(e.currentTarget))}
      >
        {isEmpty ? (
          <div className="relink-welcome">
            <p>{connected ? 'Portal connection established.' : 'Portal dormant.'}</p>
            <p>{connected ? 'Awaiting consciousness.' : 'Re-linking…'}</p>
          </div>
        ) : null}

        {start > 0 ? (
          <button type="button" ref={sentinelRef} className="stream-earlier label-data" onClick={showEarlier}>
            {start} EARLIER MESSAGE{start === 1 ? '' : 'S'} · SHOW
          </button>
        ) : null}
        {messages.slice(start).map((m, k) => {
          const i = start + k;
          return (
          <Fragment key={m.id}>
            {m.role === 'compact' ? <CompactMarker marker={m} /> : <Message message={m} onEdit={onEdit} onRevise={onRevise} onRetry={onRetry} onTakeSwitch={onTakeSwitch} onApprove={onApprove} onAsk={onAsk} onPlan={onPlan} onSeal={onSeal} onReveal={follow} onQueueEdit={onQueueEdit} onQueueNow={onQueueNow} escTakesBack={Boolean(onQueueNow) && m.holdId != null && m.holdId === escHoldId} />}
            {i === lastHistoryIdx ? (
              <div className="relink-separator"><span>SESSION RESUMED</span></div>
            ) : null}
          </Fragment>
          );
        })}

        {showThinking ? <ThinkingIndicator /> : null}
        <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      </div>
      <StreamFollow following={following} setFollowing={setFollowing} scroller={zoomRef} shown={!isEmpty} />
    </div>
  );
};
