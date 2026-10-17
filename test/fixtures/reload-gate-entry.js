/** Browser fixture for actual history loader, send gate and WebSocket service.
 * No model turn is sent: the queued frame is an interrupt with no active turn. */
import { WebSocketService } from '../../frontend/services/WebSocketService.js';
import { runLinkHistoryLoad } from '../../frontend/app/RelinkShell/stream-link-history.js';
import { createStreamSendGate } from '../../frontend/app/RelinkShell/stream-send-gate.js';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

const ref = (current) => ({ current });
window.prepareReload = async ({ token, lane }) => {
  sessionStorage.setItem('authToken', token);
  const wsService = new WebSocketService({ quiet: true });
  const resumes = [];
  wsService.on('portal:resumed', (frame) => resumes.push(frame));
  const opened = new Promise((resolve) => wsService.on('connection', resolve));
  wsService.connect();
  await opened;
  const companionRef = ref({ neumaId: lane, name: 'StorageFixture' });
  const navigationSeqRef = ref(0), historyReadyRef = ref(null), historyFailedRef = ref(false);
  let state = initialState;
  let sent = 0;
  const gate = createStreamSendGate({ wsService, companionRef, navigationSeqRef, historyReadyRef, historyFailedRef });
  const fire = () => { sent += 1; wsService.send('consciousness:interrupt'); };
  window.reloadProof = {
    resumes,
    begin() {
      historyReadyRef.current = runLinkHistoryLoad({
        wsService, companionRef, navigationSeqRef, historyFailedRef,
        dispatch: (action) => { state = reducer(state, action); },
        // This fixture has no focused folder/project: merge two actual empty frames.
        portalFocusFrame: Object.assign, focusRef: ref({}), projectsRef: ref({}),
        turnStartedRef: ref(false), projectChatSeenRef: ref(null),
        target: companionRef.current, navigationSeq: 0,
      });
      const pending = gate(fire, 'fixture interrupt');
      const immediate = sent;
      return pending.then((released) => ({ released, immediate, sent, failed: historyFailedRef.current, state }));
    },
    immediate() { const released = gate(fire); return { released, sent }; },
    close() { wsService.disconnect(); },
  };
};
