// TerminalApp — the integrated terminal as a desk window.
//
// The Body is the xterm stage, lazy-loaded so xterm only downloads when the
// witness opens the terminal. Its own dock icon; a real shell on the user's
// machine (auth-gated, localhost-only). Multiple desks can't share — one PTY
// per open terminal window.
//
// The launcher header (the VS Code gesture): the window's focus folder, and
// one button per CLI agent installed on this machine — claude, kimi, grok,
// opencode — each spawning a NEW terminal window with that agent running in
// the focus folder. The agent id rides the window's spawn payload; the
// server resolves it against a closed allowlist before any spawn.

import { Suspense, useContext, useState } from 'react';
import { AppTitle } from '../app-title.jsx';
import { FocusContext } from '../use-desk-focus.js';
import { focusFolderPath } from '../desk-focus.js';
import { useWindows } from '../../windowing/use-windows.js';
import { useSettled } from '../use-settled.js';
import { listTerminalAgents } from '../../../services/terminal-socket.js';
import { closeTerminalWindow } from '../../../services/terminal-session.js';
import './TerminalStage.css';
import { lazyChunk } from '../lazy-chunk.jsx';

const TerminalStage = lazyChunk(
  () => import('./TerminalStage.jsx').then((m) => ({ default: m.TerminalStage })),
  'THE TERMINAL',
);

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" />
    <path d="M4 6 L6.5 8 L4 10 M8 10 H11.5" />
  </svg>
);

const TerminalFallback = () => (
  <div className="vessel-fallback"><span className="label-data">TERMINAL — STARTING</span></div>
);

// The shell opens in the folder in focus (D4); with nothing in focus the
// server opens it in the home folder. The value is only a HINT — the server
// re-validates it against the opened roots (resolveFocusPath) before any
// spawn, so a hostile path can never become a shell's cwd (D3).
const TerminalBody = ({ windowId, payload }) => {
  const focus = useContext(FocusContext);
  const { dispatch } = useWindows();
  const cwd = focusFolderPath(focus?.focus ?? null);
  const [agents, setAgents] = useState([]);

  // Which CLI agents this machine can actually spawn — asked once at mount.
  useSettled((settled) => {
    listTerminalAgents()
      .then((r) => { if (!settled()) setAgents(r.agents || []); })
      .catch(() => { if (!settled()) setAgents([]); });
  }, []);

  const launchAgent = (agentId) =>
    dispatch({ type: 'OPEN_NEW', appId: 'terminal', payload: agentId });

  return (
    <div className="terminal-body">
      <div className="terminal-launcher">
        <span className="label-data terminal-launcher-cwd" title={cwd || undefined}>
          {cwd || '—'}
        </span>
        <span className="terminal-launcher-agents">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              className="terminal-agent-btn"
              onClick={() => launchAgent(a.id)}
              title={`New terminal running ${a.label} here`}
            >
              {a.label}
            </button>
          ))}
        </span>
      </div>
      <Suspense fallback={<TerminalFallback />}>
        <TerminalStage windowId={windowId} cwd={cwd} launch={payload || null} />
      </Suspense>
    </div>
  );
};

export const terminalApp = {
  label: 'TERMINAL',
  labelKey: 'apps.terminal',
  icon: <TerminalIcon />,
  Body: TerminalBody,
  storageKey: 'terminal',
  multiInstance: true,
  onClose: closeTerminalWindow,
  // Instance 1 keeps the bare TERMINAL title; siblings render as TERMINAL N.
  //
  // The NAME says what the shell RUNS, never who is seated at the desk. Passing
  // no name fell through to the globally active being (`TERMINAL // BESIDE`),
  // which read as […] — it does not: the PTY has no
  // lane attached, and switching being retitled a LIVE terminal (#249). The
  // agent id is the one thing about a terminal window that is actually true and
  // actually varies; a plain shell says so.
  makeTitle: (ordinal, payload) => (
    <AppTitle
      label={ordinal >= 2 ? `TERMINAL ${ordinal}` : 'TERMINAL'}
      labelKey={ordinal >= 2 ? undefined : 'apps.terminal'}
      name={payload ? String(payload).toUpperCase() : 'SHELL'}
    />
  ),
};
