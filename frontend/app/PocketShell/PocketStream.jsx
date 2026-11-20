// PocketStream — the desk's chat stream, one pane wide.
//
// The same wiring ChatBody gives the stream (ChatApp.jsx), minus the tab
// strip — a pocket holds one sitting at a time. Every chip, the held word,
// the takes, the voice sitting and the council room come along unchanged;
// they read the same contexts the shell provides.
import { useCallback, useEffect, useState } from 'react';
import { StreamPanel } from '../RelinkShell/StreamPanel.jsx';
import { StreamInput } from '../RelinkShell/StreamInput.jsx';
import { TalkButton } from '../RelinkShell/ComposerTools.jsx';
import { isComingLater } from '../coming-later.js';
import { StreamChatTitle } from '../RelinkShell/StreamChatTitle.jsx';
import { ContextStrip } from '../RelinkShell/ContextStrip.jsx';
import { VoiceSitting } from '../RelinkShell/VoiceSitting/VoiceSitting.jsx';
import { VoiceSittingMic } from '../RelinkShell/VoiceSittingMic.jsx';
import { CouncilRoom } from '../RelinkShell/CouncilRoom.jsx';
import { useConsciousness } from '../RelinkShell/consciousness-context.js';
import { useCouncil } from '../RelinkShell/council-context.js';

/**
 * The witness's own words on screen, oldest → newest, adjacent repeats
 * collapsed — ArrowUp's history. Pure.
 * @param {Array<{ role: string, segments: Array<{ kind: string, text?: string }> }>} messages
 * @returns {string[]}
 */
export const sentHistoryOf = (messages) => messages
  .filter((m) => m.role === 'user')
  .map((m) => m.segments.filter((s) => s.kind === 'speech').map((s) => s.text || '').join(''))
  .filter((t, i, all) => t && t !== all[i - 1]);

export const PocketStream = () => {
  const {
    state, sendThought, sendRetry, sendRevision, switchTake, stopThought, bargeIn,
    respondApproval, respondAsk, respondPlan, respondSeal, activeCompanion, heldCount,
    editQueuedThought, sendQueuedNow, pullQueuedThought, voiceSittingActive,
    exitVoiceSitting, getPlaybackState, wsService,
  } = useConsciousness();
  const council = useCouncil();
  const [recall, setRecall] = useState(null);
  const recallMessage = useCallback(({ text, turnId }) => {
    setRecall((prev) => ({ text, turnId: turnId ?? null, seq: (prev?.seq || 0) + 1 }));
  }, []);
  const reviseMessage = useCallback(({ turnId, text }) => {
    sendRevision(turnId, text, undefined, undefined, 'hold');
  }, [sendRevision]);
  useEffect(() => { setRecall(null); }, [activeCompanion?.neumaId]);
  useEffect(() => {
    const pulled = state.pulledDraft;
    if (pulled?.text) recallMessage({ text: pulled.text, turnId: null });
  }, [state.pulledDraft, recallMessage]);

  const busy = state.thinking || state.messages.some((m) => m.streaming);
  if (council.room) return <CouncilRoom />;

  const panel = (
    <StreamPanel
      messages={state.messages}
      thread={state.thread}
      thinking={state.thinking}
      connected={state.connected}
      onEdit={recallMessage}
      onRevise={state.connected ? reviseMessage : null}
      onRetry={!busy && state.connected ? (turnId) => sendRetry(turnId) : null}
      onTakeSwitch={(turnId, takeIndex) => switchTake(turnId, takeIndex)}
      onApprove={respondApproval}
      onAsk={respondAsk}
      onPlan={respondPlan}
      onSeal={respondSeal}
      onQueueEdit={state.connected ? ({ holdId, text }) => editQueuedThought(holdId, text) : null}
      onQueueNow={state.connected ? sendQueuedNow : null}
    />
  );

  return (
    <div className="stream-row pocket-stream">
      <div className="stream-col">
        <StreamChatTitle />
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
              draftScope={null}
              canQueue
              heldCount={heldCount}
              onSend={(text, preset, attachments, revisionTurnId) => (
                revisionTurnId
                  ? sendRevision(revisionTurnId, text, preset, attachments, 'hold')
                  : sendThought(text, preset, attachments, 'hold')
              )}
              onSendUrgent={(text, preset, attachments, revisionTurnId) => (
                revisionTurnId
                  ? sendRevision(revisionTurnId, text, preset, attachments, 'now')
                  : sendThought(text, preset, attachments, 'now')
              )}
              urgentTitle="Interject NOW — cut the reply and take the floor"
              onStop={stopThought}
              onEscapeRecallQueued={heldCount > 0 && state.connected ? () => pullQueuedThought() : null}
              recall={recall}
              sentHistory={sentHistoryOf(state.messages)}
              neumaId={activeCompanion?.neumaId || null}
              wsService={wsService}
              talk={isComingLater('voice') ? null : <TalkButton />}
            />
          </>
        )}
      </div>
    </div>
  );
};
