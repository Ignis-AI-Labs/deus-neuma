// ShellDock — what a chat left running, docked at the bottom of the chat (Design note, 2026-11-19: […]).
//
// One line while it is all quiet; the processes this chat started that still run (a crawl, a server, a download a
// being left "detached"), each with what it runs, where, since when, and STOP (asked twice). ALL CHATS shows every
// process any of the operator's chats started, each with the being and the chat it came from. Read every few seconds
// while the chat is on screen — the process table is the truth, and it moves on its own (chat-processes.js).

import { useCallback, useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { listChatProcesses, stopChatProcess } from '../../services/chat-processes-client.js';
import { processRows, ago } from './shell-dock-view.js';
import './ShellDock.css';

const EVERY_MS = 5000;

const Row = ({ g, now, showChat, onStop }) => {
  const [sure, setSure] = useState(false);
  return (
    <li className="shell-dock-row" data-pgid={g.pgid}>
      <code className="shell-dock-cmd" title={g.command}>{g.command || '(no command line)'}</code>
      <span className="shell-dock-meta label-data">
        {showChat ? `${String(g.laneId).toUpperCase()} · CHAT ${String(g.sessionId ?? '—').slice(-6)} · ` : ''}
        PID {g.pgid}{g.pids.length > 1 ? ` (+${g.pids.length - 1})` : ''} · {ago(g.startedAt, now)}{g.cwd ? ` · ${g.cwd}` : ''}
      </span>
      <button type="button" className="sec-scan label-data shell-dock-stop" aria-label={`${sure ? 'PRESS AGAIN TO STOP' : 'STOP'} ${g.command}`}
        onClick={() => { if (sure) onStop(g.pgid); else uiSound('open'); setSure(!sure); }}>{sure ? 'PRESS AGAIN TO STOP' : 'STOP'}</button>
    </li>
  );
};

/** @param {{laneId: ?string, wsService?: object}} props */
export const ShellDock = ({ laneId, wsService }) => {
  const [sessionId, setSessionId] = useState(() => wsService?.getSessionState?.()?.sessionId ?? null);
  const [board, setBoard] = useState(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!wsService) return undefined;
    setSessionId(wsService.getSessionState?.()?.sessionId ?? null);
    const onState = (st) => setSessionId(st?.sessionId ?? null);
    wsService.on?.('session:state', onState);
    return () => wsService.off?.('session:state', onState);
  }, [wsService]);
  const read = useCallback(() => listChatProcesses().then((b) => { setBoard(b); setError(null); setNow(Date.now()); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    read();
    const timer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') read(); }, EVERY_MS);
    return () => clearInterval(timer);
  }, [read]);
  const stop = async (pgid) => {
    uiSound('deny');
    try { await stopChatProcess(pgid); } catch (e) { setError(e.message); }
    read();
  };
  const rows = processRows(board, { laneId, sessionId, all });
  if (!board?.supported || (!rows.here.length && !rows.everywhere)) return null;
  return (
    <div className="shell-dock" aria-label="processes your chats left running" data-shell-dock="">
      <div className="shell-dock-head">
        <span className="label-data">{rows.here.length ? `RUNNING · ${rows.here.length} STARTED IN THIS CHAT` : 'NOTHING THIS CHAT STARTED IS RUNNING'}</span>
        {rows.everywhere ? (
          <button type="button" className="sec-scan label-data" aria-pressed={all} onClick={() => { uiSound('toggle'); setAll(!all); }}>
            {all ? 'THIS CHAT' : `ALL CHATS (${rows.everywhere})`}
          </button>
        ) : null}
      </div>
      {error ? <p className="shell-dock-meta label-data" role="status">{error}</p> : null}
      <ul className="shell-dock-list">
        {(all ? rows.allRows : rows.here).map((g) => <Row key={g.pgid} g={g} now={now} showChat={all} onStop={stop} />)}
      </ul>
    </div>
  );
};
