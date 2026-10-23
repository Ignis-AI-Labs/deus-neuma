// StreamChatTitle — which chat this stream is holding, said at the top.
//
// Design note, 2026-08-15: […] So it is its own slim
// line under the strip: the chat's operator-given name when it has one, its
// timestamp otherwise, the stamp riding beside a named title — always worded
// as the chat's START (2026-10-23), never a bare time that reads as the stamp
// of the reply beneath it. A sitting that has not minted a session yet reads
// NEW CHAT — a true statement, not a blank.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConsciousnessPick } from './consciousness-context.js';
import { getChatLabels } from '../../services/chat-labels.js';
import { chatTitleLine, chatTitleOf } from './stream-chats-view.js';
import { CHAT_LABELS_EVENT } from './chat-labels-bus.js';
import { useSettled } from './use-settled.js';

export const StreamChatTitle = () => {
  const { activeCompanion, wsService } = useConsciousnessPick('activeCompanion', 'wsService');
  const neumaId = activeCompanion?.neumaId || null;
  // The socket owns the binding and announces every change (resume, new chat,
  // being switch) — the title follows it, never guesses (StreamTasks' law).
  const [chatId, setChatId] = useState(() => wsService?.getSessionState?.()?.sessionId ?? null);
  useSettled(() => {
    if (!wsService) return undefined;
    setChatId(wsService.getSessionState?.()?.sessionId ?? null);
    const onState = (state) => setChatId(state?.sessionId ?? null);
    wsService.on('session:state', onState);
    return () => wsService.off('session:state', onState);
  }, [wsService]);

  const [labels, setLabels] = useState({});
  useSettled((settled) => {
    getChatLabels().then((l) => { if (!settled()) setLabels(l); });
    // A rename or an autotitle lands on the bus with the fresh map — no refetch.
    const onLabels = (e) => { if (e.detail?.labels) setLabels(e.detail.labels); };
    window.addEventListener(CHAT_LABELS_EVENT, onLabels);
    return () => window.removeEventListener(CHAT_LABELS_EVENT, onLabels);
  }, []);

  const title = chatTitleOf(labels, neumaId, chatId);
  const { t } = useTranslation('desk');
  const line = title ? chatTitleLine(title, (when) => t('stream.chatStarted', { when })) : null;
  return (
    <div className="stream-chat-title" aria-label="Active chat">
      {line ? (
        <>
          <span className="stream-chat-title-name label-data" title={title.stamp}>{line.name}</span>
          {line.stamp ? <span className="stream-chat-title-stamp label-data">{line.stamp}</span> : null}
        </>
      ) : (
        <span className="stream-chat-title-stamp label-data">{t('stream.chatStamp')}</span>
      )}
    </div>
  );
};
