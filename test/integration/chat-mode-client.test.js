/**
 * The DESK side of the chat modes — proven with the REAL client modules
 * talking to the REAL portal dispatcher over a REAL WebSocket pair, NO mock
 * on any claimed path (AGENTS.md RULE 0):
 *
 *  - createStreamActions (stream-actions.js) — the composer's setChatMode:
 *    validation, per-being persistence, the wire frame, the dormant hold.
 *  - createStreamHandlers (stream-message-handlers.js) — the ack handlers
 *    and the link-up restate, including the ORDER law (the tool stance
 *    restates first, the chat mode last, so the server's derivation wins).
 *  - The REAL stream reducer receiving the LINK dispatch.
 *  - The per-being preference law (stream-preferences.js) against the
 *    house's Map-backed storage — the browser API standing in for a node
 *    runner, never a stand-in for the behavior being claimed.
 *
 * The transport is a real `ws` socket carrying real JSON frames both ways;
 * the desk-facing adapter exposes exactly the WebSocketService surface the
 * factories consume (isConnected / send / on / setSessionState) — the wire,
 * the frames, the dispatcher, and every module under claim are real code.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handlePortalMessage } from '../../backend/routes/portal-message-handlers.js';
import { portalConnections } from '../../backend/routes/portal-connections.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { createStreamActions } from '../../frontend/app/RelinkShell/stream-actions.js';
import { createStreamHandlers } from '../../frontend/app/RelinkShell/stream-message-handlers.js';
import { initialState, reducer } from '../../frontend/app/RelinkShell/stream-reducer.js';
import {
  readChatModePref, writeChatModePref, chatModeKeyFor,
} from '../../frontend/app/RelinkShell/stream-preferences.js';
import { PURPOSE_WORK } from '../../core/voice/purpose.js';

const WITNESS = '0x5555555555555555555555555555555555555555';
const CONN_ID = 'chat-mode-client-conn';

const makeStorage = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
};

describe('the desk drives the chat modes (real client modules, real wire, gnosis)', () => {
  let httpServer, wss, serverWs, socket, clientLog, serverLog;
  let connection, desk, actions, onLinkUp;
  let deskState, reducerState, dispatch, refs;

  // The desk's transport: a real socket both ways, the WebSocketService
  // surface the factories consume. Listeners are rebuilt per test (the real
  // client re-registers per mount).
  const makeDesk = (sock) => {
    const listeners = new Map();
    const d = {
      isConnected: true,
      sent: [],
      send(type, payload = {}) {
        d.sent.push(type);
        sock.send(JSON.stringify({ type, ...payload }));
      },
      on(ev, cb) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(cb);
      },
      emit(ev, data) {
        for (const cb of listeners.get(ev) || []) cb(data);
      },
      clearListeners() { listeners.clear(); },
      setSessionState() {},
    };
    sock.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      clientLog.push(msg);
      d.emit(msg.type, msg);
      d.emit('message', msg);
    });
    return d;
  };

  const ref = (current) => ({ current });

  // Build the REAL actions + handlers over the current desk, with every
  // dependency off the claimed path an inert no-op or plain ref (harness
  // wiring, never a stand-in for claimed behavior).
  const mountDesk = () => {
    desk.clearListeners();
    desk.sent.length = 0;
    deskState = { chatMode: 'default', toolMode: 'ask' };
    reducerState = initialState;
    dispatch = (action) => { reducerState = reducer(reducerState, action); };
    refs = {
      companionRef: ref({ name: 'Aethon', neumaId: 'aethon' }),
      toolModeRef: ref('ask'),
      chatModeRef: ref('default'),
      voiceEnabledRef: ref(true),
      purposeRef: ref(PURPOSE_WORK),
      connectedRef: ref(false),
      historyLoadedRef: ref(true), // the history tail is not the path under test
      navigationSeqRef: ref(0),
      turnStartedRef: ref(false),
      erroredRef: ref(false),
      streamSeenRef: ref(false),
      transitioningRef: ref(false),
      sinkRef: ref(null),
      holdSeqRef: ref(0),
      voiceGenRef: ref(0),
      voiceGenFloorRef: ref(0),
      lastVoiceTurnRef: ref(0),
      cutVoiceTurnRef: ref(0),
      focusRef: ref(null),
      projectsRef: ref(null),
      houseRef: ref(null),
      onProjectChatCreatedRef: ref(null),
      projectChatSeenRef: ref(null),
      storageWarningRef: ref(null),
      filterRef: ref(null),
      currentTakeRef: ref(0),
    };
    const noop = () => {};
    actions = createStreamActions({
      wsService: desk, dispatch,
      ensureSink: () => ({}), portalFocusFrame: () => ({}),
      setToolModeState: (m) => { deskState.toolMode = m; },
      setChatModeState: (m) => { deskState.chatMode = m; },
      turnStartedRef: refs.turnStartedRef, erroredRef: refs.erroredRef,
      streamSeenRef: refs.streamSeenRef, sinkRef: refs.sinkRef, holdSeqRef: refs.holdSeqRef,
      voiceGenRef: refs.voiceGenRef, voiceGenFloorRef: refs.voiceGenFloorRef,
      lastVoiceTurnRef: refs.lastVoiceTurnRef, cutVoiceTurnRef: refs.cutVoiceTurnRef,
      companionRef: refs.companionRef, focusRef: refs.focusRef, projectsRef: refs.projectsRef,
      toolModeRef: refs.toolModeRef, chatModeRef: refs.chatModeRef,
    });
    const handlers = createStreamHandlers({
      wsService: desk, dispatch,
      flushSpeech: noop, ensureFilter: () => ({}), ensureSink: () => ({}),
      applyPurpose: noop, setHeldCount: noop,
      setToolModeState: (m) => { deskState.toolMode = m; },
      setChatModeState: (m) => { deskState.chatMode = m; },
      sendThought: noop, portalFocusFrame: () => ({}),
      houseRef: refs.houseRef, focusRef: refs.focusRef, projectsRef: refs.projectsRef,
      onProjectChatCreatedRef: refs.onProjectChatCreatedRef,
      projectChatSeenRef: refs.projectChatSeenRef, storageWarningRef: refs.storageWarningRef,
      companionRef: refs.companionRef, navigationSeqRef: refs.navigationSeqRef,
      transitioningRef: refs.transitioningRef, filterRef: refs.filterRef,
      streamSeenRef: refs.streamSeenRef, historyLoadedRef: refs.historyLoadedRef,
      currentTakeRef: refs.currentTakeRef, erroredRef: refs.erroredRef,
      connectedRef: refs.connectedRef, turnStartedRef: refs.turnStartedRef,
      voiceGenRef: refs.voiceGenRef, voiceGenFloorRef: refs.voiceGenFloorRef,
      lastVoiceTurnRef: refs.lastVoiceTurnRef, cutVoiceTurnRef: refs.cutVoiceTurnRef,
      toolModeRef: refs.toolModeRef, chatModeRef: refs.chatModeRef,
      voiceEnabledRef: refs.voiceEnabledRef, purposeRef: refs.purposeRef,
    });
    onLinkUp = handlers.onLinkUp;
    handlers.entries.forEach(([channel, on]) => desk.on(channel, on));
  };

  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    globalThis.localStorage = makeStorage();
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        serverWs = ws;
        ws.on('message', (d) => {
          const msg = JSON.parse(d.toString());
          serverLog.push(msg);
          handlePortalMessage(CONN_ID, msg, { birthHandler: null });
        });
        resolve();
      });
    });
    socket = new WebSocket(`ws://localhost:${port}`);
    const opened = new Promise((resolve) => socket.on('open', resolve));
    clientLog = [];
    serverLog = [];
    desk = makeDesk(socket);
    await linked;
    await opened;
  }, 60000);

  afterAll(async () => {
    socket?.close();
    wss?.close();
    httpServer?.close();
    delete globalThis.localStorage;
  });

  beforeEach(() => {
    localStorage.clear();
    clientLog.length = 0;
    serverLog.length = 0;
    connection = createPortalConnection({ ws: serverWs, walletAddress: WITNESS });
    connection.companion = { name: 'Aethon', neumaId: 'aethon' };
    portalConnections.set(CONN_ID, connection);
    mountDesk();
  });

  test('the composer declares PLAN / AUTO / DEFAULT — server truth, desk truth, and the per-being pref all land', async () => {
    const expectations = [
      ['plan', 'observe'],
      ['auto', 'auto'],
      ['default', 'ask'],
    ];
    for (const [mode, tier] of expectations) {
      clientLog.length = 0;
      actions.setChatMode(mode);
      const chatAck = await untilClient((m) => m.type === 'chat:mode');
      const toolAck = await untilClient((m) => m.type === 'tool:mode');
      expect(chatAck.mode).toBe(mode);
      expect(toolAck.mode).toBe(tier);
      // Server truth.
      expect(connection.chatMode).toBe(mode);
      expect(connection.toolMode).toBe(tier);
      // Desk truth — the REAL ack handlers moved the composer's state.
      expect(deskState.chatMode).toBe(mode);
      expect(deskState.toolMode).toBe(tier);
      // Persisted against the being it was set FOR.
      expect(localStorage.getItem(chatModeKeyFor('aethon'))).toBe(mode);
    }
  }, 30000);

  test('the desk refuses a garbage mode before the wire — no frame, no pref, no state move', async () => {
    actions.setChatMode('yolo');
    await settle(150);
    expect(desk.sent).not.toContain('chat:mode');
    expect(localStorage.getItem(chatModeKeyFor('aethon'))).toBe(null);
    expect(deskState.chatMode).toBe('default');
    expect(connection.chatMode || 'default').toBe('default');
  }, 30000);

  test('a dormant portal holds the mode locally — nothing rides a dead wire, the pref still stands', async () => {
    desk.isConnected = false;
    try {
      actions.setChatMode('plan');
      await settle(150);
      expect(desk.sent).toHaveLength(0);
      expect(serverLog).toHaveLength(0);
      expect(deskState.chatMode).toBe('plan'); // held locally, restated on link-up
      expect(localStorage.getItem(chatModeKeyFor('aethon'))).toBe('plan');
    } finally {
      desk.isConnected = true;
    }
  }, 30000);

  test('link-up restates the stance with the chat mode LAST — the server derivation wins', async () => {
    // The contradiction on purpose: the old tool stance says ask, the chat
    // mode says auto. The chat frame rides last so its derivation is final.
    refs.toolModeRef.current = 'ask';
    refs.chatModeRef.current = 'auto';

    onLinkUp();

    await untilClient(() => clientLog.filter((m) => m.type === 'chat:mode').length === 1);
    // TWO tool:mode acks: the restated stance first, the derivation's last.
    await untilClient(() => clientLog.filter((m) => m.type === 'tool:mode').length === 2);
    expect(clientLog.filter((m) => m.type === 'tool:mode').map((a) => a.mode)).toEqual(['ask', 'auto']);
    expect(serverLog.map((m) => m.type)).toEqual(['tool:mode', 'chat:mode', 'voice:pref']);
    expect(serverLog[0].mode).toBe('ask');
    expect(serverLog[1].mode).toBe('auto');
    // The derivation won: one declaration carries both.
    expect(connection.chatMode).toBe('auto');
    expect(connection.toolMode).toBe('auto');
    // The desk shows only what the portal acked.
    expect(deskState.chatMode).toBe('auto');
    expect(deskState.toolMode).toBe('auto');
    // The REAL reducer took the LINK.
    expect(reducerState.connected).toBe(true);
  }, 30000);

  test('a declaration still in flight survives a reconnect restate — the stale mode never overwrites it', async () => {
    // The race (desk-navigation, ~1 in 6): the operator presses AUTO, and the
    // link comes up again ('connection' / 'portal:resumed') before the ack
    // lands. The restate must carry what the operator declared, not the mode
    // the desk last had acked — or the server is put back on DEFAULT.
    actions.setChatMode('auto');
    onLinkUp();

    await untilClient(() => clientLog.filter((m) => m.type === 'chat:mode').length === 2);
    expect(serverLog.filter((m) => m.type === 'chat:mode').map((m) => m.mode)).toEqual(['auto', 'auto']);
    expect(connection.chatMode).toBe('auto');
    expect(deskState.chatMode).toBe('auto');
  }, 30000);

  test('a tool stance still in flight survives a reconnect restate too', async () => {
    actions.setToolMode('observe');
    // The restate carries the stance just pressed, never the last acked one
    // (the chat mode still rides last and derives the tier, by law).
    onLinkUp();
    await untilClient(() => clientLog.filter((m) => m.type === 'tool:mode').length === 3);
    expect(serverLog.filter((m) => m.type === 'tool:mode').map((m) => m.mode)).toEqual(['observe', 'observe']);
  }, 30000);

  test('the desk never shows a mode the portal is not holding — a forged ack is ignored', async () => {
    deskState.chatMode = 'plan';
    deskState.toolMode = 'observe';
    serverWs.send(JSON.stringify({ type: 'chat:mode', mode: 'yolo' }));
    serverWs.send(JSON.stringify({ type: 'tool:mode', mode: 'yolo' }));
    await settle(150);
    expect(deskState.chatMode).toBe('plan');
    expect(deskState.toolMode).toBe('observe');
  }, 30000);

  test('the per-being pref law — scoped wins, legacy inherits, beings never leak into each other', () => {
    // A being with its own declared mode reads it.
    writeChatModePref('aethon', 'plan');
    expect(readChatModePref('aethon')).toBe('plan');
    // Another being never inherits a sibling's mode.
    expect(readChatModePref('sovereign')).toBe('default');
    // Continuity from the old ACTS stance: auto stays auto...
    localStorage.setItem('neuma.tools.mode', 'auto');
    expect(readChatModePref('sovereign')).toBe('auto');
    // ...a scoped declaration still wins over the legacy key...
    expect(readChatModePref('aethon')).toBe('plan');
    // ...and every other legacy reading lands on the free-flow default.
    localStorage.setItem('neuma.tools.mode', 'observe');
    expect(readChatModePref('sovereign')).toBe('default');
    localStorage.setItem('neuma.tools.mode', 'ask');
    expect(readChatModePref('sovereign')).toBe('default');
    // Garbage in storage fails closed.
    localStorage.setItem(chatModeKeyFor('aethon'), 'yolo');
    expect(readChatModePref('aethon')).toBe('default');
    // Writing one being's pref never moves another's.
    writeChatModePref('sovereign', 'auto');
    expect(readChatModePref('sovereign')).toBe('auto');
    expect(localStorage.getItem(chatModeKeyFor('aethon'))).toBe('yolo');
  });
});
