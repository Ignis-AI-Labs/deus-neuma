// session-follow — every surface sitting in the same conversation hears when
// a turn starts or settles on any of them.
//
// The portal writes a turn's frames to the one connection that sent the
// message. A phone and a desk bound to the SAME wallet, being, and session
// are siblings, and each is blind to the other's turn (Corwin, 2026-09-07:
// […]). Faber persists each event and fans it out to
// every tail of the session; Neuma's stream files are frozen, so this layer
// sits at the socket instead: it watches what each socket is bound to, and
// when a turn starts or settles on one socket it tells the siblings with
// one small frame. The siblings then read the session from disk through
// their own resume road (use-reconnect-reload). Message-level follow; the
// live token mirror is a separate piece.
//
// A turn STARTS when the operator speaks (inbound consciousness:stream /
// retry) — announced on the first frame the portal sends back, because by
// then the turn-point is on disk (_persistTurnPoint runs before the provider
// is asked) and a sibling reading disk sees the words. Not on the thinking
// frame: with reasoning off it never comes. A turn SETTLES on
// consciousness:complete, which also names the session a fresh chat was
// minted into.
//
// PURE decisions above the line, the socket layer below it.

import { verifySessionToken } from './auth.js';
import { createLogger } from './logger.js';

const log = createLogger('SessionFollow');

export const FOLLOW_FRAME = 'portal:sibling';
// How long a closed socket's sitting is kept waiting for its turn to settle.
export const CLOSED_KEEP_MS = 30 * 60_000;

// Inbound frames that (re)bind a socket to a being and a session — the same
// set the portal calls navigation — and the two that open a turn.
const REBIND_TYPES = new Set(['companion:manifest', 'portal:resume', 'portal:new-session']);
const SPEAK_TYPES = new Set(['consciousness:stream', 'consciousness:retry']);
const INBOUND_TYPES = new Set([...REBIND_TYPES, ...SPEAK_TYPES]);

/** @returns {{ wallet: string|null, neumaId: string|null, sessionId: string|null, spoke: boolean, inTurn: boolean }} */
export const emptyBind = (wallet = null) => ({ wallet, neumaId: null, sessionId: null, spoke: false, inTurn: false });

/**
 * What the surface just said: where it sits, or that the operator spoke. Pure.
 * @param {ReturnType<typeof emptyBind>} bind
 * @param {{ type?: string, neumaId?: string, sessionId?: string }} frame
 */
export const bindAfterInbound = (bind, frame) => {
  switch (frame?.type) {
    case 'companion:manifest':
      return { ...bind, neumaId: frame.neumaId ?? bind.neumaId, sessionId: null, spoke: false, inTurn: false };
    case 'portal:resume':
      return { ...bind, neumaId: frame.neumaId ?? bind.neumaId, sessionId: frame.sessionId ?? null, spoke: false, inTurn: false };
    case 'portal:new-session':
      return { ...bind, sessionId: null, spoke: false, inTurn: false };
    case 'consciousness:stream':
    case 'consciousness:retry':
      return { ...bind, spoke: true };
    default:
      return bind;
  }
};

/**
 * What the portal just told the surface: the first answer to the operator's
 * words (the turn began, its point on disk) or the complete (it settled). Pure.
 * @param {ReturnType<typeof emptyBind>} bind
 * @param {{ type?: string, sessionId?: string }} frame
 * @returns {{ bind: ReturnType<typeof emptyBind>, phase: 'started'|'settled'|null }}
 */
export const bindAfterOutbound = (bind, frame) => {
  const type = String(frame?.type ?? '');
  if (type === 'consciousness:complete') {
    return { bind: { ...bind, sessionId: frame.sessionId ?? bind.sessionId, spoke: false, inTurn: false }, phase: 'settled' };
  }
  if (bind.spoke && !bind.inTurn && (type.startsWith('consciousness:') || type.startsWith('tool:'))) {
    return { bind: { ...bind, spoke: false, inTurn: true }, phase: 'started' };
  }
  return { bind, phase: null };
};

/**
 * Two binds sit in one conversation: same wallet and session, and the same
 * being wherever both sides have named one. A session id is unique on its
 * own; a socket the portal answers on before it has said its being (seen
 * live: a settle delivered to a phone's fresh reconnect) must still match.
 * Pure.
 */
export const sameSitting = (a, b) =>
  Boolean(a?.wallet && a?.sessionId)
  && a.wallet === b?.wallet && a.sessionId === b?.sessionId
  && (!a.neumaId || !b?.neumaId || a.neumaId === b.neumaId);

/** The frame a sibling receives. Pure. */
export const followFrame = (phase, bind) => ({
  type: FOLLOW_FRAME, phase, neumaId: bind.neumaId, sessionId: bind.sessionId,
});

/** Only the turn's own frames matter; parse nothing else. Pure. */
export const worthParsing = (raw) =>
  typeof raw === 'string' && (raw.includes('"consciousness:') || raw.includes('"tool:'));

/** The wallet a socket was opened with, from the upgrade request. Pure over the token. */
export const walletOfRequest = (req) => {
  try {
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    return token ? (verifySessionToken(token)?.address ?? null) : null;
  } catch {
    return null;
  }
};

// ── the socket layer ────────────────────────────────────────────────────────

/**
 * impure — a registry of live portal sockets and what each is bound to.
 * `admit` is called once per accepted /ws socket, BEFORE the portal's own
 * connection handler sees it, so the outbound wrap catches every frame.
 * @param {{ walletOf?: (req: import('http').IncomingMessage) => string|null }} [deps]
 */
export const createSessionFollow = ({ walletOf = walletOfRequest } = {}) => {
  const binds = new Map();

  const notify = (origin, phase) => {
    const bind = binds.get(origin);
    if (!bind?.sessionId) return;
    const raw = JSON.stringify(followFrame(phase, bind));
    let told = 0;
    for (const [ws, other] of binds) {
      if (ws === origin || !sameSitting(bind, other)) continue;
      try { if (ws.readyState === ws.OPEN) { ws.send(raw); told += 1; } } catch { /* a sibling mid-close */ }
    }
    // Never silent (Rule 3): a sitting with no sibling to tell is a fact worth reading.
    log.debug('sibling turn', { phase, told, sockets: binds.size, neumaId: bind.neumaId, sessionId: bind.sessionId });
  };

  // A socket that died mid-turn still owns that turn: the portal writes the
  // settle to it (seen live — a phone that slept). Its sitting is kept until
  // that settle, or until it is plainly stale, so the siblings still hear.
  const forget = (ws) => binds.delete(ws);
  const sweep = () => {
    const stale = Date.now() - CLOSED_KEEP_MS;
    for (const [ws, bind] of binds) if (bind.closedAt && bind.closedAt < stale) forget(ws);
  };

  const admit = (ws, req) => {
    sweep();
    binds.set(ws, emptyBind(walletOf(req)));
    const send = ws.send.bind(ws);
    ws.send = (data, ...rest) => {
      if (worthParsing(data)) {
        try {
          const before = binds.get(ws) ?? emptyBind();
          const { bind, phase } = bindAfterOutbound(before, JSON.parse(data));
          binds.set(ws, bind);
          if (phase) notify(ws, phase);
          if (phase === 'settled' && bind.closedAt) forget(ws);
        } catch { /* not a frame of ours */ }
      }
      return send(data, ...rest);
    };
    ws.on('message', (raw) => {
      try {
        const frame = JSON.parse(raw);
        if (!INBOUND_TYPES.has(frame?.type)) return;
        const bind = bindAfterInbound(binds.get(ws) ?? emptyBind(), frame);
        binds.set(ws, bind);
        if (REBIND_TYPES.has(frame.type)) {
          log.debug('sitting bound', { via: frame.type, neumaId: bind.neumaId, sessionId: bind.sessionId, wallet: bind.wallet ? `${bind.wallet.slice(0, 6)}…` : null });
        }
      } catch { /* not JSON — the portal answers that */ }
    });
    ws.on('close', (code, reason) => {
      const bind = binds.get(ws);
      if (!bind) return;
      // The close code names who hung up: 1000 the page's own script, 1001 a
      // page going away, 1005/1006 the network or the OS with no word.
      log.debug('socket closed', { code, reason: String(reason ?? ''), inTurn: bind.inTurn, sessionId: bind.sessionId });
      if (bind.inTurn || bind.spoke) binds.set(ws, { ...bind, closedAt: Date.now() });
      else forget(ws);
    });
  };

  return { admit, size: () => binds.size };
};
