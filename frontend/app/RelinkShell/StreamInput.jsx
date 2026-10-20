// StreamInput — the witness speaks. Chamfered control register; Enter sends,
// Shift+Enter breaks the line, a severed link disables it (placeholder says
// why). Above the field sits THE MODEL BAR (ModelBar.jsx): this being's
// model, effort rung, and ULTRA where the vendor has one (sampling modes
// moved to Settings › INFERENCE — the turn reads the saved one server-side).
// While a reply streams the send control becomes STOP (cancel-and-revise);
// ArrowUp in an empty field recalls the last sent message, and EDIT on a
// sent message re-seeds it here.
// Hold-to-talk dictation: hold the mic button or Space to speak; the
// transcript appends to the draft for review, never auto-sends. Inside the
// field a TAP of Space still types a space — only a HOLD becomes dictation,
// so speak/pause/hold-again keeps adding to the same thought.
// Typing "/" opens the slash palette over the installed skills library —
// arrows navigate, Tab/Enter complete, Enter on a fully-typed name sends.
// The Escape LADDER (the palette still claims the first Escape while open):
// 1 tap on an EMPTY field recalls the newest QUEUED word (flow untouched),
// 2 taps clear the draft, 3 taps INTERRUPT the current speaker, 4 taps are
// THE GAVEL — the full call to order. Climbing past the wipe restores the
// draft: the room stops so the witness's prepared words can be heard.
//
// Size-law seams (bodies moved verbatim): the per-chat draft lives in
// use-stream-draft.js, hold-to-talk dictation in use-hold-to-talk.js, the
// slash palette in StreamPalette.jsx, and attachment admission + chips in
// StreamAttachments.jsx. The Escape ladder stays HOME — its rungs reach
// every other concern in this composer.

import { memo, useEffect, useRef, useState } from 'react';
import { ModelBar } from './ModelBar.jsx';
import { HouseActivityChip } from './HouseActivityChip.jsx';
import { BenchRunChip } from './BenchRunChip.jsx';
import { DictationSetup } from './DictationSetup.jsx';
import { useLiveVoice } from './use-live-voice.js';
import { LiveButton, RefineButton, useRefineDraft } from './ComposerTools.jsx';
import { commandFromInput } from './commands.js';
import { useCommandDispatch } from './use-command-dispatch.js';
import { uiSound } from '../../services/ui-sound.js';
import { stepRecall, mayStep } from './sent-history.js';
import { filesFrom } from './attachments.js';
import { uploadAttachments } from '../../services/attachments-client.js';
import { prepareAttachmentSend } from './attachment-send.js';
import { AttachMenu } from './AttachMenu.jsx';
import { ModeMenu } from './ModeMenu.jsx';
import { VoxChip } from './VoxChip.jsx';
import { ComposeGauge } from './ComposeGauge.jsx';
import { escTapChain } from './draft-wipe.js';
import { useStreamDraft } from './use-stream-draft.js';
import { useHoldToTalk } from './use-hold-to-talk.js';
import { useSlashPalette, StreamPalette } from './StreamPalette.jsx';
import { useStreamAttachments, AttachmentRow } from './StreamAttachments.jsx';

// A long thought grows the field downward (natural formatting), never a
// horizontal scroll. Cap ≈ 7 lines, then the field itself scrolls.
const MAX_FIELD_PX = 168;
// Chromium sizes the field itself (`field-sizing: content`); the JS measure is the fallback.
const FIELD_SIZES_ITSELF = typeof CSS !== 'undefined' && Boolean(CSS.supports?.('field-sizing', 'content'));
// One element, reused — a fresh one per keystroke would break ModelBar's memo.
// The row's right end: a benchmark running on this machine, then who is working.
const TRAILING = <span className="relink-modelbar-trailing"><BenchRunChip /><HouseActivityChip /></span>;

const MIC_HINT = Object.freeze({
  idle: 'Hold to speak',
  recording: 'Listening — release to transcribe',
  transcribing: 'Transcribing…',
  error: 'Dictation failed',
});

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
  </svg>
);

// onSendUrgent (optional): a second, louder way to send the SAME draft — the
// council's "interject NOW" gear; an extra send control renders beside the
// quiet one when provided.
// sentHistory: the witness's sent messages (oldest -> newest) -- ArrowUp
// walks back through them CLI-style, ArrowDown walks forward to empty.
// maxChars (optional): the host's hard send cap -- an over-long draft is
// REFUSED IN PLACE with an honest note, never cleared and never cut (the
// council's 4000-char silent slice cut a founding address, 2026-07-23).
const StreamInputView = ({ connected, busy, onSend, onSendUrgent, urgentTitle, onStop, onBargeIn, recall, sentHistory = [], maxChars = null, neumaId = null, canQueue = false, heldCount = 0, onEscapeInterrupt = null, onEscapeOrder = null, onEscapeRecallQueued = null, purpose = 'work', wsService = null, draftScope = null }) => {
  const fieldRef = useRef(null);
  const { value, setValue } = useStreamDraft({ wsService, neumaId, draftScope });
  // Where the history walk stands (null = not walking). A ref, not state —
  // it only matters inside the keydown that moves it.
  const recallCursorRef = useRef(null);
  // The one honest refusal line for an over-cap draft (cleared the moment
  // the draft shrinks under the cap, or on a successful send).
  const [sendNote, setSendNote] = useState(null);
  // The Escape ladder's standing: {at, chain, wiped} — when the last Escape
  // landed, which rung it reached, and the draft rung 2 wiped (restored if
  // the chain climbs on). Typing breaks the chain.
  const escTapRef = useRef(null);

  // LIVE mode — the open mic. In a declared CONVERSATION sitting (purpose =
  // server truth via the host) the toggle arms the streaming lane: mic_open
  // → PCM pump → server-VAD partials/finals; the final enters as an ordinary
  // thought through the portal's own frames (no pendingLive round-trip). Any
  // other sitting keeps the legacy path byte-identical: VAD speech-start
  // (barge-in fires), speech-end closes the utterance, whisper transcribes,
  // auto-sends the moment the portal is free. Typing stays available.
  const [pendingLive, setPendingLive] = useState(null);
  const { live, state: liveState, toggleLive } = useLiveVoice({
    connected, // LIVE stands down when the portal drops — no hot mic on a dead socket
    purpose,
    wsService,
    onSpeechStart: () => onBargeIn?.(),
    // Consecutive utterances while a send is still settling merge into one
    // thought — a witness thinking in phrases is one thought, not spam.
    onUtterance: (text) => setPendingLive((prev) => (prev ? `${prev} ${text}` : text)),
  });
  useEffect(() => {
    if (!pendingLive || (busy && !canQueue) || !connected) return;
    onSend(pendingLive);
    setPendingLive(null);
  }, [pendingLive, busy, canQueue, connected, onSend]);

  const {
    mic, setup, dismissSetup, beginCapture, end, pointerHoldRef, onFieldKeyDown,
  } = useHoldToTalk({ connected, live, setValue, fieldRef });
  const refine = useRefineDraft({ value, setValue, fieldRef, neumaId });

  // A message recalled for revision (EDIT on a sent message) seeds the field.
  // THE EDIT-FORK: the recall's turnId marks this draft a REVISION of its
  // point — submit re-sends from the point (a new take), never a fresh
  // message. The marker retires on submit, on any field Escape, and when
  // the recall clears (a companion switch — the point belongs to its being).
  const revisionRef = useRef(null);
  useEffect(() => {
    revisionRef.current = recall?.turnId ?? null;
    if (!recall?.text) return;
    setValue(recall.text);
    fieldRef.current?.focus();
  }, [recall, setValue]);

  // Shared images — pasted or dropped, previewed as chips, uploaded on send
  // (ids ride the portal frame; the bytes ride REST — WS frames cap at 64KB).
  const {
    attachments, setAttachments, attachNote, setAttachNote,
    uploading, setUploading, vision, addFiles, removeAttachment,
  } = useStreamAttachments({ connected, neumaId });

  // Height tracks content: collapse, then fit — so deleting lines shrinks
  // the field back instead of leaving dead space.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el || FIELD_SIZES_ITSELF) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_PX)}px`;
  }, [value]);

  const submit = async (urgent = false) => {
    // The urgent gear (council's "interject NOW") rides the SAME submit
    // path — commands, readiness gates, upload-first — only the final
    // handler differs. Enter and the plain send stay the quiet way.
    const fire = urgent && onSendUrgent ? onSendUrgent : onSend;
    // A value that is solely a command token runs the action — never sent to the
    // neuma as speech (this catches "/summon " typed past the palette + Enter).
    const command = commandFromInput(value);
    if (command) { if (runOrSay(command)) setValue(''); return; }
    const text = value.trim();
    // The host's hard cap: refuse IN PLACE — the draft stays whole for the
    // witness to split, and nothing half-sends (the backend refuses too,
    // but by then a cleared field would have lost their words).
    if (maxChars && text.length > maxChars) {
      setSendNote(`THIS WORD RUNS ${text.length.toLocaleString()} CHARACTERS -- THE ROOM HOLDS ${maxChars.toLocaleString()}. SPLIT IT; NOTHING WAS SENT.`);
      return;
    }
    const payload = prepareAttachmentSend(attachments);
    if (!payload.ok) { setAttachNote(payload.reason); return; }
    const ready = attachments;
    // busy: the send control reads STOP while a reply streams — Enter must
    // honor the same gate, not send behind the affordance's back. An
    // attachment alone is a complete thought; text is optional when one rides.
    // `canQueue`: the caller holds mid-stream words and delivers them when the
    // current action finishes, so a busy stream is no longer a closed door (ruling, 2026-07-26).
    // Without it, busy still blocks — every existing caller behaves as before.
    if ((!text && ready.length === 0) || !connected || (busy && !canQueue) || uploading) return;
    if (ready.length === 0) {
      fire(text, undefined, undefined, revisionRef.current ?? undefined);
      revisionRef.current = null; // a sent word retires the revision marker
      setValue('');
      setSendNote(null);
      recallCursorRef.current = null; // a sent word ends the history walk
      return;
    }
    // Bytes/text ride REST first; only the returned ids cross the portal frame.
    // A failed upload keeps the draft AND the chips — nothing half-sends.
    setUploading(true);
    try {
      const { images, files } = payload;
      const ids = await uploadAttachments({ images, files });
      // The FILES' NAMES ride the send — the operator's own bubble shows what
      // was attached (ruling, 2026-09-17), live and after a reload.
      fire(text, undefined, { ids, previews: images, names: files.map((f) => f.name) }, revisionRef.current ?? undefined);
      revisionRef.current = null; // a sent word retires the revision marker
      setValue('');
      setAttachments((current) => current.filter((a) => !ready.some((sent) => sent.key === a.key)));
      setAttachNote(null);
      setSendNote(null);
      recallCursorRef.current = null; // a sent word ends the history walk
    } catch (err) {
      setAttachNote(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const runCommand = useCommandDispatch();

  // A command either acts on the DESK (window, ceremony, session) or SPEAKS to
  // whoever is seated. The speaking kind rides the ordinary send path so the
  // words land in the transcript as the operator's own — a hidden instruction
  // would leave the being answering a question nobody can see it was asked.
  const runOrSay = (command) => {
    if (command?.run?.type !== 'say') return runCommand(command);
    if (!connected || (busy && !canQueue) || uploading) return false;
    onSend(command.run.text);
    return true;
  };

  const { palette, acceptItem, onPaletteKey } = useSlashPalette({
    value, setValue, fieldRef, runOrSay, submit,
  });

  return (
    <div
      className="relink-compose"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = filesFrom(e.dataTransfer);
        if (files.length === 0) return;
        e.preventDefault();
        addFiles(files);
      }}
    >
      {/* The palette must live OUTSIDE .relink-input: that box is chamfered
          with a clip-path, and a positioned descendant painted above the box
          is clipped to nothing (proven live — the palette was invisible). */}
      <StreamPalette palette={palette} acceptItem={acceptItem} />
      <AttachmentRow attachments={attachments} attachNote={attachNote} removeAttachment={removeAttachment} />
      <ComposeGauge draftLength={value.trim().length} maxChars={maxChars} sendNote={sendNote} />
      <ModelBar beingId={neumaId} trailing={TRAILING} />
      <div className="relink-inputrow">
        {/* Missing speech components — invite the install instead of a bare
            error flash; anchored above the composer. */}
        {setup ? <DictationSetup missing={setup.missing} onDismiss={dismissSetup} /> : null}
        {/* Everything a witness can bring in — files, a folder focus, a project.
            Lives BESIDE the chamfered box: its drop-up would be clipped inside. */}
        <AttachMenu
          disabled={!connected}
          vision={vision}
          onFiles={addFiles}
          onNote={setAttachNote}
        />
        {/* The chat's standing MODE and the being's VOX — down here at the
            composer's eye level, never up in the window corner (Founder
            2026-08-26). ModeMenu's drop-up anchors to .relink-compose. */}
        <ModeMenu disabled={!connected} />
        <VoxChip disabled={!connected} />
        <div className="relink-input">
          {/* What is being heard flows INTO the field at the caret as a
              revising provisional span (use-hold-to-talk) — the operator sees
              exactly what will be entered, where it will be entered. */}
          <div className={`relink-input-in${mic === 'recording' ? ' is-listening' : ''}`}>
            <textarea
              ref={fieldRef}
              rows={1}
              className="relink-input-field"
              placeholder={
                !connected ? 'Portal disconnected…'
                  : mic === 'recording' ? 'Listening…'
                  : mic === 'transcribing' ? 'Transcribing…'
                  : liveState === 'opening' ? 'Opening the voice lane…'
                  : liveState === 'capturing' ? 'Hearing you…'
                  : liveState === 'transcribing' ? 'Transcribing…'
                  : live ? 'LIVE — speak any time'
                  : 'Share your thoughts…'
              }
              value={value}
              disabled={!connected}
              autoComplete="off"
              onChange={(e) => {
                setValue(e.target.value);
                // Typing breaks the Escape ladder — a new thought, a new chain.
                escTapRef.current = null;
                // The refusal note stands only while the draft is over cap.
                if (sendNote && (!maxChars || e.target.value.trim().length <= maxChars)) setSendNote(null);
              }}
              onPaste={(e) => {
                // An image on the clipboard becomes a chip; text pastes as text.
                const files = filesFrom(e.clipboardData);
                if (files.length === 0) return;
                e.preventDefault();
                addFiles(files);
              }}
              onKeyDown={(e) => {
                if (onFieldKeyDown(e)) return;
                if (onPaletteKey(e)) return;
                if (e.key === 'Escape') {
                  // An Escape stands down the edit-fork too — the draft may
                  // survive the ladder, but it no longer re-sends FROM the
                  // recalled point.
                  revisionRef.current = null;
                  // Palette closed (its Escape was claimed above). The Escape
                  // LADDER (Founder's law, 2026-07-23; rung 1 added 2026-08-16) —
                  // the same counts, every stream, no context surprises:
                  //   1 tap, empty field → recall the newest QUEUED word
                  //   2 taps → clear the draft
                  //   3 taps → INTERRUPT the current speaker
                  //   4 taps → THE GAVEL: the full call to order
                  // Climbing PAST the wipe un-wipes: a witness heading for
                  // the interrupt or the gavel keeps the words they were
                  // preparing — the room stops so they can be HEARD.
                  const now = Date.now();
                  const prior = escTapRef.current;
                  const chain = escTapChain(now, prior?.at ?? null, prior?.chain ?? 0);
                  const step = { at: now, chain, wiped: chain > 1 ? prior?.wiped ?? null : null };
                  if (chain === 1 && !value && onEscapeRecallQueued) {
                    // The FIRST tap, empty-handed, while the portal holds a
                    // word: it comes home to be reworked, the flow untouched
                    // (ruling, 2026-08-16). A drafted field is never stomped.
                    e.preventDefault();
                    uiSound('tick');
                    onEscapeRecallQueued();
                  } else if (chain === 2 && value) {
                    e.preventDefault();
                    uiSound('close');
                    step.wiped = value;
                    setValue('');
                  } else if (chain === 3) {
                    e.preventDefault();
                    if (step.wiped != null) { setValue(step.wiped); step.wiped = null; }
                    if (onEscapeInterrupt) onEscapeInterrupt();
                    else if (busy && onStop) onStop();
                  } else if (chain === 4 && onEscapeOrder) {
                    e.preventDefault();
                    onEscapeOrder();
                  }
                  escTapRef.current = step;
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  // CLI-style history walk: Up steps back through sent
                  // messages, Down steps forward and finally out to empty.
                  // Only an UNTOUCHED draft walks (empty, or exactly the
                  // recalled entry), and only from the caret's edge — inside
                  // a multiline draft the arrows keep moving the caret.
                  const el = fieldRef.current;
                  const caretAtStart = !value || (el && el.selectionStart === 0 && el.selectionEnd === 0);
                  const caretAtEnd = !value || (el && el.selectionStart === value.length && el.selectionEnd === value.length);
                  if (value === '') recallCursorRef.current = null; // an emptied field restarts the walk
                  const edgeOk = e.key === 'ArrowUp' ? caretAtStart : caretAtEnd;
                  if (edgeOk && mayStep(value, sentHistory, recallCursorRef.current)) {
                    const step = stepRecall(sentHistory, recallCursorRef.current, e.key === 'ArrowUp' ? 'back' : 'forward');
                    if (step) {
                      e.preventDefault();
                      uiSound('tick');
                      recallCursorRef.current = step.cursor;
                      setValue(step.text);
                    }
                  }
                }
              }}
            />
            {(value.trim() || refine.state !== 'idle') && <RefineButton {...refine} disabled={!value.trim() || mic === 'recording'} />}
            <LiveButton live={live} liveState={liveState} connected={connected} purpose={purpose} toggleLive={toggleLive} />
            <button
              type="button"
              className={`relink-mic is-${mic}`}
              disabled={!connected || live}
              aria-label={live ? 'LIVE mode owns the mic' : MIC_HINT[mic]}
              title={live ? 'LIVE mode owns the mic' : MIC_HINT[mic]}
              onPointerDown={(e) => {
                e.preventDefault();
                // Capture the pointer for the hold: release anywhere ends the
                // capture, and the spurious pointerleave Chromium emits when the
                // button's class (and thus hit-test) changes can't cut it short.
                e.currentTarget.setPointerCapture(e.pointerId);
                pointerHoldRef.current = true;
                beginCapture();
              }}
              onPointerUp={() => { pointerHoldRef.current = false; end(); }}
              onPointerCancel={() => { pointerHoldRef.current = false; end(); }}
            >
              <MicIcon />
            </button>
            {busy ? (
              <>
                {/* MID-STREAM (ruling, 2026-07-26): while a reply runs, the witness
                    keeps BOTH ways to speak — interject now, or hold the word
                    for the next completed action — beside the stop. Watching a
                    being work stopped being read-only. */}
                {canQueue && onSendUrgent ? (
                  <button
                    type="button"
                    className="relink-send relink-send--urgent"
                    onClick={() => submit(true)}
                    disabled={!connected || uploading}
                    aria-label={urgentTitle || 'Interject now'}
                    title={urgentTitle || 'Interject now — cut the reply and take the floor'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M13 2 L5 13 H11 L9.5 22 L19 9 H12.5 Z" />
                    </svg>
                  </button>
                ) : null}
                {canQueue ? (
                  <button
                    type="button"
                    className="relink-send relink-send--hold"
                    onClick={() => submit(false)}
                    disabled={!connected || uploading}
                    aria-label="Queue this message after the current action"
                    title={heldCount > 0
                      ? `Hold — ${heldCount} already waiting; they go in order after completed actions`
                      : 'Hold — it goes after the current action finishes'}
                  >
                    {heldCount > 0 ? (
                      <span className="relink-send-held label-data">{heldCount}</span>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path d="M12 6 V12 L16 14" />
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="relink-send relink-send--stop"
                  onClick={() => { uiSound('deny'); onStop(); }}
                  aria-label="Stop the response"
                  title="Cut the response — what was spoken stays"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                {onSendUrgent ? (
                  <button
                    type="button"
                    className="relink-send relink-send--urgent"
                    onClick={() => submit(true)}
                    disabled={!connected || uploading}
                    aria-label={urgentTitle || 'Send urgently'}
                    title={urgentTitle || 'Send urgently'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M13 2 L5 13 H11 L9.5 22 L19 9 H12.5 Z" />
                    </svg>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="relink-send"
                  onClick={() => submit(false)}
                  disabled={!connected || uploading}
                  aria-label={uploading ? 'Uploading images…' : 'Send thought'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Memoized: the transcript moves every streamed frame; the composer's inputs do not.
export const StreamInput = memo(StreamInputView);
