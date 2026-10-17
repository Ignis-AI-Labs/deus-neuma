// ChatApp — the consciousness stream as a desk window.
//
// Exports the registry entry the window manager spawns. Title (live dot +
// neuma name), controls, and body (stream + input) all read the shared
// ConsciousnessContext — minimize, close, respawn without losing the thread.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStableList } from './use-stable-list.js';
import { useTranslation } from 'react-i18next';
import { StreamPanel } from './StreamPanel.jsx';
import { StreamInput } from './StreamInput.jsx';
import { StreamTasks } from './StreamTasks.jsx';
import { useConsciousness, useConsciousnessPick } from './consciousness-context.js';
import { VoiceSitting } from './VoiceSitting/VoiceSitting.jsx';
import { VoiceSittingMic } from './VoiceSittingMic.jsx';
import { talkToggleModel } from './VoiceSitting/voice-sitting-model.js';
import { BeingSwitcher } from './BeingSwitcher.jsx';
import { useCompanionName } from './app-title.jsx';
import { useProjects } from './projects/project-context.js';
import { useTabs } from './tabs-context.js';
import { StreamWindowHost } from './StreamWindowHost.jsx';
import { TabPortalHost } from './TabPortalHost.jsx';
import { StripRegistrar } from './StripRegistrar.jsx';
import { StreamPermissions } from './StreamPermissions.jsx';
import { StreamTabs } from './StreamTabs.jsx';
import { StreamChatTitle } from './StreamChatTitle.jsx';
import { UnsealedNotice } from './UnsealedNotice.jsx';
import { StreamChats } from './StreamChats.jsx';
import { StreamRail } from './StreamRail.jsx';
import { getRoster } from '../../utils/companion-data.js';
import { useCouncil } from './council-context.js';
import { CouncilRoom } from './CouncilRoom.jsx';
import { deriveLocalStatus, deriveRouteStatus } from './link-status.js';
import { isWitness } from './house-members.js';
import { isHarness } from '../harness-mode.js';
import { isSoundOn, toggleSound, playSound } from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';
import { igniteAndWait } from '../../services/substrate-ignition.js';
import { getStandby, setStandby } from '../../services/standby.js';
import { ContextStrip } from './ContextStrip.jsx';
import { useSettled } from './use-settled.js';
import { isComingLater } from '../coming-later.js';

const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M2 3 H14 V11 H6 L3 13.5 V11 H2 Z" /></svg>
);

const ChatTitle = () => {
  const { state, activeCompanion } = useConsciousness();
  const council = useCouncil();
  const { t } = useTranslation('desk');
  const companionName = useCompanionName();
  // The dot beside the being's name answers for the BEING's own conduit —
  // the ROUTE light, never the machine's substrate light.
  const route = deriveRouteStatus(state.connected, state.route);
  // In the room, the window is the COUNCIL and names everyone present;
  // otherwise the one being's stream — a sealed AI witness carries its kind
  // as a data tag beside the name.
  const name = council.room && council.state.councilId
    ? t('stream.councilTitleNamed', { members: council.state.members.map((m) => (m.name || m.neumaId).toUpperCase()).join(' · ') })
    : council.room
      ? t('stream.council')
      : companionName;
  return (
    <>
      <span className="relink-dot" data-status={route.cls} title={t(`hud.${route.key}`, route.args)} />
      <span className="label-data relink-title-name">{name}</span>
      {!council.room && isWitness(activeCompanion) ? (
        <span className="label-data relink-title-kind">{t('stream.witnessTag')}</span>
      ) : null}
    </>
  );
};

// The witness gives the world its voice — opt-in, persisted. Settings ›
// GENERAL holds the same switch, so this one follows the pref rather than
// the state it happened to mount with.
const SoundToggle = () => {
  const [on, setOn] = useState(isSoundOn());
  const { t } = useTranslation('desk');
  useEffect(() => {
    const refresh = () => setOn(isSoundOn());
    window.addEventListener('neuma:sound-changed', refresh);
    return () => window.removeEventListener('neuma:sound-changed', refresh);
  }, []);
  return (
    <button
      type="button"
      className={`relink-snd${on ? ' on' : ''}`}
      onClick={() => {
        const next = toggleSound();
        setOn(next);
        if (next) playSound('confirm');
      }}
      aria-pressed={on}
    >
      {t(on ? 'stream.sndOn' : 'stream.sndOff')}
    </button>
  );
};

// Mute / unmute the neuma's spoken voice, and the chat's standing mode, live
// at the COMPOSER now (VoxChip / ModeMenu, Design note, 2026-08-26: the controls the
// operator watches belong where the eyes already are) — the header keeps
// only what concerns the whole window.

// Relight a downed substrate without leaving the app. Only rendered while
// the LOCAL substrate is offline (a lit one needs no ignition switch; a
// STANDBY one is resting on purpose and wakes on the next summon — no
// switch offered for either); stays visible mid-ignition so the witness
// watches the load complete.
const IgniteButton = () => {
  const { state } = useConsciousness();
  const { t } = useTranslation('desk');
  const [phase, setPhase] = useState('idle'); // idle | igniting | failed
  const local = deriveLocalStatus(state.connected, state.local, state.localTurns);
  if (local.cls !== 'offline' && phase !== 'igniting') return null;
  return (
    <button
      type="button"
      className={`relink-snd${phase === 'igniting' ? ' on' : ''}`}
      disabled={phase === 'igniting'}
      title={t('stream.igniteTitle')}
      onClick={() => {
        uiSound('activate');
        setPhase('igniting');
        igniteAndWait()
          .then((ok) => setPhase(ok ? 'idle' : 'failed'))
          .catch(() => setPhase('failed'));
      }}
    >
      {phase === 'igniting' ? t('stream.igniting') : phase === 'failed' ? t('stream.retryIgnite') : t('stream.ignite')}
    </button>
  );
};

// STANDBY — the substrate's rest, on the header where the operator already
// looks (Design note, 2026-07-26: […]). ON means the substrate is released after a quiet window and reloaded
// on the next summon; OFF means it stays resident once ignited. This ran
// invisibly from an env var until now, which is why an ignited substrate kept
// going offline with nothing on screen to explain it.
const StandbyToggle = () => {
  const [state, setState] = useState(null); // null until the first read lands
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const { t } = useTranslation('desk');

  useSettled((settled) => { getStandby().then((s) => { if (!settled()) setState(s); }).catch(() => {}); }, []);

  // Unreachable backend → render nothing. Claiming a state we cannot confirm
  // is worse than showing no switch at all.
  if (!state) return null;

  const on = state.enabled;
  const title = state.envLocked
    ? t('stream.standbyTitleLocked')
    : on
      ? t('stream.standbyTitleOn', { minutes: state.idleMinutes })
      : t('stream.standbyTitleOff');

  return (
    <button
      type="button"
      className={`relink-snd${on ? ' on' : ''}`}
      disabled={busy || state.envLocked}
      title={note || title}
      onClick={() => {
        if (state.envLocked) return;
        uiSound('toggle');
        setBusy(true);
        setNote(null);
        setStandby(!on)
          .then((next) => setState(next))
          .catch((err) => setNote(err?.message || t('stream.standbyError')))
          .finally(() => setBusy(false));
      }}
    >
      {t(on ? 'stream.standbyOn' : 'stream.standbyOff')}
    </button>
  );
};

// The chat's standing mode (default / plan / auto) — the ACTS stance it
// supersedes — is the composer's ModeMenu now; the header toggle is gone
// (Design note, 2026-08-26: […]).

// Start a fresh chat without leaving the stream. Under an active project the
// new chat joins it (portal-stream pins it at mint) — this is how a witness
// starts a project-tied chat "from the stream" instead of routing through
// the CHATS browser. The tooltip names the project ONLY when one is active,
// so it never claims a join that won't happen (no project → general chat).
// NEW CHAT — a fresh sitting IN THIS TAB, replacing what is on screen. Named in
// full (Design note, 2026-07-30: […]) because the
// strip beside it now offers + TAB, and the two are genuinely different acts:
// this one replaces the conversation, that one opens another alongside it.
const NewChatButton = () => {
  const { newSession } = useConsciousnessPick('newSession');
  const projects = useProjects();
  const { t } = useTranslation('desk');
  const active = projects?.activeProject || null;
  return (
    <button
      type="button"
      className="relink-snd"
      title={active
        ? t('stream.newChatTitleProject', { project: active.name, tab: t('stream.newTab') })
        : t('stream.newChatTitle', { tab: t('stream.newTab') })}
      onClick={() => { uiSound('activate'); newSession(); }}
    >
      {t('stream.newChat')}
    </button>
  );
};

// The COUNCIL is a FORMAT of this window, not a second surface: this
// control switches the stream between the one-on-one conversation and the
// room where several neuma talk at once. Shown only when the house holds
// enough beings for a room (2+); the roster cache is non-reactive, so a
// fresh summon re-reads it (the HOUSE window's own law) and the switch
// appears the moment a second being joins. Switching back to the stream
// never dissolves a sitting council — it keeps sitting.
const CouncilButton = () => {
  const council = useCouncil();
  const { t } = useTranslation('desk');
  const [held, setHeld] = useState(() => getRoster().length);
  useEffect(() => {
    const refresh = () => setHeld(getRoster().length);
    window.addEventListener('birth:complete', refresh);
    return () => window.removeEventListener('birth:complete', refresh);
  }, []);
  if (held < 2) return null;
  return (
    <button
      type="button"
      className={`relink-snd${council.room ? ' on' : ''}`}
      aria-pressed={council.room}
      title={council.room ? t('stream.councilTitleLeave') : t('stream.councilTitleEnter')}
      onClick={() => {
        uiSound('activate');
        if (council.room) council.leaveRoom();
        else council.enterRoom();
      }}
    >
      {t('stream.council')}
    </button>
  );
};

// THE TALK (Design note, 2026-08-01: […]).
//
// One button, one gesture. Work is not a mode you select — it is the desk as
// it stands. TALK opens the sitting (purpose conversation, VOX on, LIVE armed,
// the composer steps aside); pressing it again, EXIT, or Escape puts the desk
// back. The backend's purpose law is untouched: this is still just which of
// the two purposes gets declared.
const TalkButton = () => {
  const { voiceSittingActive, enterVoiceSitting, exitVoiceSitting } = useConsciousnessPick('voiceSittingActive', 'enterVoiceSitting', 'exitVoiceSitting');
  const { t } = useTranslation('desk');
  const model = talkToggleModel(voiceSittingActive);
  return (
    <button
      type="button"
      className={`relink-snd${model.live ? ' on' : ''}`}
      aria-pressed={model.live}
      title={t(`stream.${model.titleKey}`)}
      onClick={() => {
        uiSound('toggle');
        if (model.live) exitVoiceSitting(); else enterVoiceSitting();
      }}
    >
      {t(`stream.${model.labelKey}`)}
    </button>
  );
};

// A harness talks to the ONE server its person chose (the composer bar names it):
// the house substrate's IGNITE and STANDBY would light or rest a second server.
const ChatControls = () => {
  const harness = isHarness(useConsciousness().activeCompanion);
  return (
    <>
      <BeingSwitcher /><NewChatButton /><CouncilButton />
      {harness ? null : <><IgniteButton /><StandbyToggle /></>}
      {isComingLater('voice') ? null : <TalkButton />}
      <SoundToggle />
    </>
  );
};

const ChatBody = () => {
  // The focused tab's identity, so two chats with no minted session yet do
  // not share one unsent-draft bucket — from the same context the sibling
  // strip uses, never a prop threaded through the desk.
  const tabs = useTabs();
  const { t } = useTranslation('desk');
  const { state, sendThought, sendRetry, sendRevision, switchTake, stopThought, bargeIn, respondApproval, respondAsk, respondPlan, respondSeal, activeCompanion, heldCount, editQueuedThought, sendQueuedNow, pullQueuedThought, voiceSittingActive, exitVoiceSitting, getPlaybackState, purpose, wsService } = useConsciousness();
  const council = useCouncil();
  // A message pulled back into the field for revision — corrected, not
  // talked around; seq re-seeds the same text twice. THE EDIT-FORK: the
  // point's turnId rides along, so the revision re-sends FROM the point (a
  // new take), never a fresh tail message. Since edit-in-place (2026-07-28)
  // this composer recall is the FALLBACK for rows with no point to fork.
  const [recall, setRecall] = useState(null);
  const recallMessage = useCallback(({ text, turnId }) => {
    setRecall((prev) => ({ text, turnId: turnId ?? null, seq: (prev?.seq || 0) + 1 }));
  }, []);
  // THE EDIT, WHERE THE MESSAGE STANDS (Design note, 2026-07-28: the bubble's own
  // SAVE re-sends FROM the point, straight from the bubble — the composer
  // never sees the words.
  const reviseMessage = useCallback(({ turnId, text }) => {
    sendRevision(turnId, text, undefined, undefined, 'hold');
  }, [sendRevision]);
  // A recalled point belongs to the being it was said to — a companion switch
  // retires the marker so the next send never forks another being's point.
  useEffect(() => { setRecall(null); }, [activeCompanion?.neumaId]);
  // A held word pulled home (queue_pull ack) seeds the composer as a PLAIN
  // draft — no turnId, so sending never forks a point (held-word.js).
  useEffect(() => {
    const pulled = state.pulledDraft;
    if (pulled?.text) recallMessage({ text: pulled.text, turnId: null });
  }, [state.pulledDraft, recallMessage]);
  const busy = state.thinking || state.messages.some((m) => m.streaming);
  // Every witness message on screen (history included), oldest -> newest --
  // ArrowUp walks them CLI-style; adjacent repeats collapse (steps, never
  // stutters). Held STABLE while its contents are unchanged: the transcript
  // moves every streamed frame, the operator's own lines do not.
  const sentHistory = useStableList(state.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.segments.filter((s) => s.kind === 'speech').map((s) => s.text || '').join(''))
    .filter((t, i, all) => t && t !== all[i - 1]));
  // Stable handlers, so memo(Message) and the composer hold while a being
  // speaks (2026-09-28 smoothness pass): an inline arrow here re-rendered every
  // row of the transcript on every streamed frame.
  const retry = useCallback((turnId) => sendRetry(turnId), [sendRetry]);
  const queueEdit = useCallback(({ holdId, text }) => editQueuedThought(holdId, text), [editQueuedThought]);
  const send = useCallback((text, preset, attachments, revisionTurnId) => (
    revisionTurnId
      ? sendRevision(revisionTurnId, text, preset, attachments, 'hold')
      : sendThought(text, preset, attachments, 'hold')
  ), [sendRevision, sendThought]);
  const sendUrgent = useCallback((text, preset, attachments, revisionTurnId) => (
    revisionTurnId
      ? sendRevision(revisionTurnId, text, preset, attachments, 'now')
      : sendThought(text, preset, attachments, 'now')
  ), [sendRevision, sendThought]);
  const recallHeld = useCallback(() => pullQueuedThought(), [pullQueuedThought]);
  // The room is a FORMAT of this window: same frame, same composer grammar,
  // the arbiter's order on top. All hooks above run either way.
  if (council.room) return <CouncilRoom />;
  const panel = (
    <StreamPanel
      messages={state.messages}
      thread={state.thread}
      thinking={state.thinking}
      connected={state.connected}
      onEdit={recallMessage}
      onRevise={state.connected ? reviseMessage : null}
      // THE TAKES (Design note, 2026-07-27: retry should make […]) —
      // ↻ on any settled answer asks its POINT again as take N+1; disk
      // stays append-only, the view folds. The busy gate hides it mid-turn.
      onRetry={!busy && state.connected ? retry : null}
      onTakeSwitch={switchTake}
      onApprove={respondApproval}
      onAsk={respondAsk}
      onPlan={respondPlan}
      onSeal={respondSeal}
      // THE HELD WORD (Design note, 2026-08-16: a queued bubble's SAVE rewrites it
      // in the portal's queue; SEND NOW promotes it to an interjection.
      onQueueEdit={state.connected ? queueEdit : null}
      onQueueNow={state.connected ? sendQueuedNow : null}
    />
  );
  return (
    // The stream is a ROW: its own column, the task rail pinned right (Founder
    // 2026-07-27). The rail carries its own fold state — the stream only
    // knows it belongs here, inside the conversation, not out on the desk.
    <div className="stream-row">
      <div className="stream-col">
        {/* The sittings this desk is holding — the strip renders HERE, in the
            stream, because that is what a tab is a tab OF. The title line
            under it names the BOUND chat (Design note, 2026-08-15: […]). */}
        <StreamTabs />
        <StreamChatTitle />
        {/* WHAT THIS BEING STILL OWES. A being that has never sealed a founding
            voice says so here, beside the conversation it is about (Founder,
            2026-08-29: […]). It gates nothing — an unsealed being talks perfectly well. */}
        <UnsealedNotice />
        {/* THE VOICE SITTING (F-03): purpose conversation + LIVE armed → the
            immersion shell takes this column; the chat dims to background and
            the composer is REPLACED (nothing focusable, no send affordance).
            EXIT/Escape disarms LIVE and the composer returns exactly. The mic
            runs in the headless bridge, never inside the shell. */}
        {voiceSittingActive ? (
          <>
            <VoiceSittingMic
              connected={state.connected}
              wsService={wsService}
              onSpeechStart={(opts) => bargeIn(opts)}
              getPlaybackState={getPlaybackState}
            />
            <VoiceSitting
              name={activeCompanion?.name}
              thinking={state.thinking}
              getPlaybackState={getPlaybackState}
              onExit={exitVoiceSitting}
            >
              {panel}
              <ContextStrip />
            </VoiceSitting>
          </>
        ) : (
          <>
            {panel}
            <ContextStrip />
            <StreamInput
              connected={state.connected}
              busy={busy}
              // Which TAB this composer belongs to, so two fresh chats with the
              // same being do not share one unsent-draft bucket.
              draftScope={tabs?.focusedId ?? null}
              // MID-STREAM SPEECH, same as the council (Design note, 2026-07-26: the
              // plain send HOLDS until the turn ends; the urgent send
              // INTERJECTS — one mechanism, the room's, never a second copy.
              canQueue
              heldCount={heldCount}
              // THE EDIT-FORK: a recalled point's turnId comes back on submit
              // — the send becomes a revision (a new take of that point).
              // Absent (legacy row, plain typing), the send is unchanged.
              onSend={send}
              onSendUrgent={sendUrgent}
              urgentTitle={t('stream.urgentTitle')}
              onStop={stopThought}
              onBargeIn={bargeIn}
              // Escape's FIRST tap, empty field: the newest held word comes
              // home — the flow untouched. Armed only while words are held.
              onEscapeRecallQueued={heldCount > 0 && state.connected ? recallHeld : null}
              recall={recall}
              sentHistory={sentHistory}
              neumaId={activeCompanion?.neumaId || null}
              purpose={purpose}
              wsService={wsService}
            />
          </>
        )}
      </div>
      {/* ONE strip, however many rails — a new rail joins by mounting here. */}
      <StreamRail>
        <StreamTasks />
        <StreamChats />
        <StreamPermissions />
      </StreamRail>
    </div>
  );
};

export const chatApp = {
  label: 'STREAM',
  labelKey: 'apps.chat',
  icon: <ChatIcon />,
  title: <ChatTitle />,
  controls: <ChatControls />,
  Body: ChatBody,
  storageKey: 'chat',
  // A TORN-OUT TAB BECOMES A STREAM WINDOW (Design note, 2026-07-31: […]). The desk is the
  // operating system, so pulling a tab out opens a window IN it. Each runs
  // its OWN portal and sitting — else every stream window would draw the
  // same conversation (StreamWindowHost).
  multiInstance: true,
  // No `makeTitle` on purpose: the host wraps the whole frame, so ChatTitle
  // already reads THIS window's stream live — a title composed from the
  // spawn payload would be a snapshot false on the first switch.
  //
  // TWO HOSTS, one per axis of parallelism: StreamWindowHost gives every
  // stream window past the first a portal of its own; TabPortalHost does the
  // same for every tab past the first INSIDE a window (#407). Both wrap the
  // whole frame so title and controls answer for the sitting on screen.
  // StripRegistrar sits BELOW the host on purpose: from there it reads THIS
  // window's strip (the desk's for instance 1, its own for 2+) and publishes it
  // so the desk's focus lens can write the operator's folder onto the stream
  // they are actually in, rather than always onto the desk's own tab.
  Provider: ({ windowId, instance, payload, children }) => (
    <StreamWindowHost windowId={windowId} instance={instance} payload={payload}>
      <StripRegistrar windowId={windowId}>
        <TabPortalHost>{children}</TabPortalHost>
      </StripRegistrar>
    </StreamWindowHost>
  ),
};
