// CouncilRoom — THE COUNCIL as a FORMAT of the stream, not a second surface.
//
// The STREAM window hosts it: the header's COUNCIL control switches the one
// window between one-on-one conversation and the room, so the operator never
// learns a duplicate interface. The composer IS the stream's own composer
// (StreamInput — Enter sends, dictation, slash palette, all of it); what the
// room adds on top is the arbiter's format: the member strip with hand marks,
// the floor, hand notes, INTERJECT arming and INTERRUPT, and the queue
// readout. One member holds the floor at a time; the others raise hands —
// 'hold' (waiting its turn) or 'open' (asking for the floor now). Leaving
// the room view never dissolves a sitting council; DISSOLVE does.

import { useEffect, useRef, useState } from 'react';
import './CouncilRoom.css';
import './CouncilRoom-strip.css';
import './CouncilRoom-transcript.css';
import { useCouncil } from './council-context.js';
import { useConsciousness } from './consciousness-context.js';
import { StreamInput } from './StreamInput.jsx';
import { Markdown } from './Markdown.jsx';
import { useTextZoom } from './use-text-zoom.js';
import { getWitnessName } from './witness-name.js';
import { isWitness } from './house-members.js';
import { playSound } from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';
import { atTail } from './stream-follow.js';
import { StreamFollow } from './StreamFollow.jsx';
import { actFilePath } from './act-link.js';
import { useWindows } from '../windowing/use-windows.js';
import { ApprovalChip } from './ApprovalChip.jsx';
import { CopyWord, speechText } from './copy-word.jsx';
import { formatClockStamp } from '../../utils/format.js';
import { CouncilConvene } from './CouncilConvene.jsx';
import { CouncilSeat, CouncilSpeaking } from './CouncilSeat.jsx';
import { CouncilDissolve } from './CouncilDissolve.jsx';

// Each speaker's own hue — the operator speaks in SIGNAL, members take
// their seat's color. Twelve hues for twelve seats (MAX_MEMBERS): a full
// room never wears the same color twice. Personal choice comes in a later
// cycle (SETTINGS).
const voiceColor = (speaker, members) => {
  if (speaker === 'witness') return 'var(--voice-witness)';
  const seat = members.findIndex((m) => m.neumaId === speaker);
  return seat === -1 ? 'var(--color-text-secondary)' : `var(--voice-${(seat % 12) + 1})`;
};

// LINE & CYCLE: custom SVG marks, never font pictographs. A gear for an
// act that landed, a thin cross for one the sandbox refused.
const ToolMark = ({ ok }) => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    {ok ? (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5 V4 M8 12 V14.5 M1.5 8 H4 M12 8 H14.5 M3.4 3.4 L5.2 5.2 M10.8 10.8 L12.6 12.6 M12.6 3.4 L10.8 5.2 M5.2 10.8 L3.4 12.6" />
      </>
    ) : (
      <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" />
    )}
  </svg>
);

// The backend's say law (council-session.js SAY_MAX_CHARS) — the composer
// refuses an over-cap draft IN PLACE so the operator's words are never lost
// to a cleared field, and the server's refusal is only ever the belt.
const COUNCIL_SAY_MAX_CHARS = 16000;

const CouncilSitting = ({ council, connected }) => {
  const { state, say, interrupt, order, approve, close } = council;
  const windows = useWindows();

  const send = (urgency) => (thought) => {
    playSound('confirm');
    say(thought, urgency);
  };

  const memberHoldsFloor = state.floor != null && state.floor !== 'witness';
  // Raised hands in SPEAKING order (1 = next), not roster order — what the
  // room will hear, in the order it will hear it. `raised` is who's in
  // line (the collapsed summary); `notes` are the hands that brought words
  // (the expanded panel).
  const raised = state.members
    .map((m) => ({ member: m, ...(state.hands[m.neumaId] || { hand: 'rest', note: '' }) }))
    .filter((h) => h.hand !== 'rest')
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  const notes = raised.filter((h) => h.note);
  // The hands panel rests COLLAPSED — a one-line who's-next; the operator
  // peeks at the full notes when they want them, and the transcript keeps
  // the room's space the rest of the time.
  const [handsOpen, setHandsOpen] = useState(false);

  // The operator's own words in the record, oldest → newest — ArrowUp in the
  // composer walks back through them CLI-style (adjacent repeats collapse).
  const sentHistory = state.messages
    .filter((m) => m.speaker === 'witness')
    .map((m) => (m.segments || []).filter((s) => s.kind === 'speech').map((s) => s.text || '').join(''))
    .filter((t, i, all) => t && t !== all[i - 1]);

  // The operator holds a seat like everyone else: green while their word
  // has the floor, yellow while words wait in the queue, red standby.
  const witnessHand = state.floor === 'witness' ? 'open' : (state.witnessQueue > 0 ? 'hold' : 'rest');
  const witnessName = getWitnessName() || 'Operator';

  // The transcript follows the room: stick to the tail while the operator
  // is already reading it (within a screen of the bottom), never yank the
  // scroll away from someone reading back.
  const tailRef = useRef(null);
  // Ctrl+scroll zooms the room's transcript, the same muscle memory as the
  // one-on-one stream (Ctrl+0 over it resets) — its own remembered zoom.
  const { ref: zoomRef, style: zoomStyle } = useTextZoom('council');
  const liveTail = state.messages.at(-1);
  // The tail grows by chunk (last speech segment lengthens), by act (a
  // chip segment lands), or by a chip settling (acting→resolved can grow
  // its rendered line) — either way the room keeps following.
  const tailSeg = liveTail?.segments.at(-1);
  const tailStamp = liveTail
    ? `${liveTail.segments.length}:${tailSeg?.kind === 'tool'
      ? `${tailSeg.phase}:${tailSeg.error?.length ?? 0}`
      : tailSeg?.text?.length ?? 0}`
    : '';
  // The follow law (stream-follow.js): snap to the tail by default; the
  // operator scrolling up RELEASES it — they read at reading speed, even
  // while several members stream — and returning to the tail (or taking
  // the ▼ LIVE control) re-arms it.
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    const el = tailRef.current;
    if (!el) return;
    if (following) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, tailStamp, following]);

  // THE GROUND — one folder, the one standing open in the Explorer (Founder,
  // 2026-07-26). The room used to show two other things instead: the HOUSE
  // workspace, and a per-external-seat […] negotiation. Both answered a question the operator never asked —
  // the folder they have open is the folder everyone is working on, and a
  // room that names a different one is describing somebody else's session.
  // Read the SERVER's answer, not our own. `state.houseWorkspace` is the ground
  // the session actually resolved — `reachableGround(…, focusGroundOf(connection))`,
  // which returns null when the filesystem server refuses the path and every
  // seat's tools stay dark. Deriving it here from the Explorer's focus instead
  // would print "GROUND · /path" over a room where nothing can be read: the
  // display claiming a reach the seats do not have. It also covers the
  // unfocused case for free, because the server falls back to the house
  // workspace there and says so.
  const ground = state.houseWorkspace;

  return (
    <>
      <header className="council-strip">
        <ul className="council-members">
          <CouncilSeat
            name={witnessName}
            color={voiceColor('witness', state.members)}
            hand={witnessHand}
            order={state.witnessOrder}
            holdsFloor={state.floor === 'witness'}
          />
          {state.members.map((m) => (
            <CouncilSeat
              key={m.neumaId}
              name={m.name || m.neumaId}
              color={voiceColor(m.neumaId, state.members)}
              hand={state.hands[m.neumaId]?.hand || 'rest'}
              order={state.hands[m.neumaId]?.order || null}
              holdsFloor={state.floor === m.neumaId}
              considering={state.considering.includes(m.neumaId)}
              external={isWitness(m)}
            />
          ))}
        </ul>
        {/* When nobody holds the floor and nothing is queued, say what the
            room is doing: members weighing their hands is CONSIDERING —
            visible thinking, never dead air — and true quiet is the
            witness's open floor. */}
        {!state.floor && state.witnessQueue === 0 ? (
          state.considering.length > 0 ? (
            <span className="council-considers label-data">THE ROOM CONSIDERS…</span>
          ) : (
            <span className="council-floor-open label-data">THE FLOOR IS OPEN</span>
          )
        ) : null}
        {state.witnessQueue > 0 ? (
          <span className="council-queue label-data">{state.witnessQueue} HELD</span>
        ) : null}
        {memberHoldsFloor ? (
          <button type="button" className="council-interrupt label-data" onClick={() => { playSound('menuOpen'); interrupt(); }}>
            INTERRUPT
          </button>
        ) : null}
        <CouncilDissolve key={state.councilId} close={close} connected={connected} error={state.error} />
      </header>
      {/* THE GROUND — the folder open in the Explorer, named once for the
          whole room. Everyone seated is working on it; nothing else is. */}
      {ground ? (
        <div className="council-grounds">
          <div className="council-ground label-data" title="The folder every seat in this room is working on — resolved and reachability-checked by the server, not guessed from the Explorer">
            GROUND · {ground}
          </div>
        </div>
      ) : null}
      {raised.length > 0 ? (
        <div className="council-notes-block">
          {/* Collapsed, the line itself answers "who's next": every raised
              hand in speaking order, each in its seat's color. Open, the
              full notes — what each hand wants to say — read below. */}
          <button
            type="button"
            className="council-notes-head label-data"
            aria-expanded={handsOpen}
            title={handsOpen ? 'Collapse the raised hands' : 'Open the raised hands — every note in speaking order'}
            onClick={() => { playSound('menuOpen'); setHandsOpen((v) => !v); }}
          >
            <svg
              className={`council-notes-chev${handsOpen ? ' is-open' : ''}`}
              width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"
            >
              <path d="M2 1 L6 4 L2 7" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span className="council-notes-title">HANDS</span>
            <span className="council-notes-order">
              {raised.map((h, i) => (
                <span key={h.member.neumaId} style={{ color: voiceColor(h.member.neumaId, state.members) }}>
                  {i > 0 ? ' · ' : ''}{h.member.name || h.member.neumaId}
                </span>
              ))}
            </span>
          </button>
          {handsOpen && notes.length > 0 ? (
            <ul className="council-notes">
              {notes.map((h) => (
                <li key={h.member.neumaId} className="council-note">
                  <span style={{ color: voiceColor(h.member.neumaId, state.members) }}>{h.member.name || h.member.neumaId}</span>
                  {' — '}{h.note}
                </li>
              ))}
            </ul>
          ) : null}
          {handsOpen && notes.length === 0 ? (
            <p className="council-notes-quiet label-data">HANDS RAISED — NO NOTES CARRIED.</p>
          ) : null}
        </div>
      ) : null}

      <div
        className="council-transcript"
        style={zoomStyle}
        ref={(el) => { tailRef.current = el; zoomRef.current = el; }}
        onScroll={(e) => setFollowing(atTail(e.currentTarget))}
      >
        {state.messages.map((m, i) => (m.kind === 'approval' ? (
          // A member's ask past the house ground — the operator's gate, the
          // SAME chip as the one-on-one stream (one approval grammar
          // everywhere): ALLOW ONCE / ALWAYS ALLOW / DENY.
          <div key={`approval-${m.id}`} className="council-approval">
            <ApprovalChip segment={m} onRespond={approve} />
          </div>
        ) : m.kind === 'order' ? (
          // THE GAVEL in the record — the operator called the room to order.
          // A deliberate mark, so the cut threads read as governance, never
          // as a fault in the room.
          <div key={`order-${i}`} className="council-order label-data" role="status">
            <span className="council-order-mark">— THE ROOM IS CALLED TO ORDER —</span>
            {m.at ? <span className="council-turn-when label-data">{formatClockStamp(m.at)}</span> : null}
          </div>
        ) : m.kind === 'hands' ? (
          // The round's verdict: every listener's hand after the operator
          // spoke. REST reads as receipt — heard, nothing to add — and a
          // member whose answer never landed is named (UNREAD/UNREACHABLE),
          // so silence is always legible: a decision or a fault, never a
          // mystery.
          <div key={`hands-${m.turnId}-${i}`} className="council-hands label-data" role="status">
            <span className="council-hands-head">HEARD</span>
            {m.reports.map((r) => (
              <span key={r.neumaId} className="council-hands-verdict" data-received={r.received}>
                <span style={{ color: voiceColor(r.neumaId, state.members) }}>
                  {state.members.find((mm) => mm.neumaId === r.neumaId)?.name || r.neumaId}
                </span>
                {' '}
                {r.hand ? r.hand.toUpperCase() : (r.received === 'unreachable' ? 'UNREACHABLE' : 'UNREAD')}
              </span>
            ))}
          </div>
        ) : (
          <div key={`${m.speaker}-${m.turnId}-${i}`} className={`council-turn${m.live ? ' is-live' : ''}`}>
            <span className="council-turn-name" style={{ color: voiceColor(m.speaker, state.members) }}>
              {m.name}
              {m.live ? <CouncilSpeaking /> : null}
              {/* WHEN the turn was spoken — time alone today, date joined
                  on for another day's, so a witness reading back a room
                  they weren't in can track the conversation's clock. */}
              {!m.live && m.at ? (
                <span className="council-turn-when label-data">{formatClockStamp(m.at)}</span>
              ) : null}
              {/* COPY a settled turn's words — anyone's, paste-ready. */}
              {!m.live ? <CopyWord text={speechText(m.segments)} className="council-turn-copy" /> : null}
            </span>
            <div className="council-turn-words">
              {/* Speech and acts interleave IN the turn, in arrival order —
                  the same flow the one-on-one stream reads in. The display
                  filter already kept tool payloads out of the speech. */}
              {m.segments.map((s, j) => (s.kind === 'tool' ? (
                <div
                  key={`s-${j}`}
                  className={`council-tool${s.phase === 'acting' ? ' is-acting' : s.ok ? '' : ' is-refused'}`}
                >
                  <span className="council-tool-act label-data">
                    <ToolMark ok={s.ok !== false} /> {s.label}
                    {/* A file act's target is a LINK — click it and stand in
                        the file the member touched (act-link.js decides;
                        directory acts stay plain text). */}
                    {s.path ? (actFilePath(s.label, s.path) ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="council-tool-path"
                          title="Open this file in the editor"
                          onClick={() => {
                            uiSound('activate');
                            windows.dispatch({ type: 'OPEN_NEW', appId: 'editor', payload: s.path });
                          }}
                        >
                          {s.path}
                        </button>
                      </>
                    ) : ` · ${s.path}`) : ''}
                    {s.phase === 'resolved' && !s.ok && s.error ? ` — ${s.error}` : ''}
                  </span>
                </div>
              ) : (
                <Markdown key={`s-${j}`} text={s.text} />
              )))}
            </div>
          </div>
        )))}
        {/* The floor was granted but the first word is still on its way —
            show the speaker gathering themselves, so the grant is felt the
            instant it happens, not at the first streamed chunk. */}
        {memberHoldsFloor && !state.messages.some((m) => m.speaker === state.floor && m.live) ? (
          <div className="council-turn council-turn-pending">
            <span className="council-turn-name" style={{ color: voiceColor(state.floor, state.members) }}>
              {state.members.find((m) => m.neumaId === state.floor)?.name || state.floor}
              <CouncilSpeaking pending />
            </span>
          </div>
        ) : null}
        {state.error ? (
          <p className="council-error label-data">{state.error.message}</p>
        ) : null}
      </div>
      <StreamFollow following={following} setFollowing={setFollowing} scroller={tailRef} />

      {/* The stream's OWN composer carries the traffic light at the send
          itself: while a member is speaking the draft has two gears — the
          quiet send queues it (yellow — after they finish), the urgent
          send interjects (green — the room hears it at the next boundary).
          With the floor open there is only the one way to speak. busy
          stays false BY DESIGN: the witness queues while members speak;
          cutting the floor is the strip's INTERRUPT, and the witness's
          VOICE cutting in (onBargeIn) is an interrupt too. */}
      <StreamInput
        connected={connected}
        busy={false}
        onSend={send('hold')}
        onSendUrgent={memberHoldsFloor ? send('now') : undefined}
        urgentTitle="Interject NOW — the room hears this at the next boundary"
        onBargeIn={interrupt}
        recall={null}
        sentHistory={sentHistory}
        maxChars={COUNCIL_SAY_MAX_CHARS}
        // The Escape LADDER's council rungs (Founder's law 2026-07-23): rung 3
        // cuts the floor holder (the strip's INTERRUPT, without reaching for
        // the mouse); rung 4 is THE GAVEL — the full conscious call to order
        // that stops everyone, even the considering, and lowers every hand.
        // Rung 2 (the draft wipe) lives in the composer itself; the ladder
        // restores the draft when climbed past — order is called to be HEARD.
        onEscapeInterrupt={() => { playSound('menuOpen'); interrupt(); }}
        onEscapeOrder={() => { uiSound('deny'); order(); }}
      />
    </>
  );
};

export const CouncilRoom = () => {
  const council = useCouncil();
  const { state: streamState } = useConsciousness();

  const onConvene = (neumaIds) => {
    playSound('menuOpen');
    council.openCouncil(neumaIds);
  };

  return (
    <div className="council">
      {council.state.councilId ? (
        <CouncilSitting council={council} connected={streamState.connected} />
      ) : (
        <>
          <CouncilConvene
            onConvene={onConvene}
            onResume={council.resumeCouncil}
            past={council.state.past}
            requestPast={council.listCouncils}
          />
          {council.state.error ? (
            <p className="council-error label-data">{council.state.error.message}</p>
          ) : null}
        </>
      )}
    </div>
  );
};
