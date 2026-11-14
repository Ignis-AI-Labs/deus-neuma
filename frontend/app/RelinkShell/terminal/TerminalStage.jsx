// TerminalStage — xterm.js wired to the integrated-terminal socket.
//
// Lazy-loaded (this module + xterm is its own chunk), so the terminal only
// downloads when the operator opens it. Mounts xterm into a ref, fits it to the
// window via FitAddon + a ResizeObserver (and tells the PTY the new size), and
// disposes the view on unmount. Only explicit window close kills the shell;
// auth navigation and renderer reload detach within the backend's bounded TTL.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './TerminalStage.css';
import { openTerminalSocket } from '../../../services/terminal-socket.js';
import { bindTerminalTextSize } from './terminal-text-size.js';
import {
  readTerminalSession, rememberTerminalSession, forgetTerminalSession,
  registerTerminalWindow, closeTerminalSession,
} from '../../../services/terminal-session.js';
import { useTerminalDictation } from './use-terminal-dictation.js';
import { doorsIn, doorAt, terminalCellAt, terminalPathFor, TERMINAL_LINK_ITEMS } from './terminal-links.js';
import { openPathDoor, openPathMenu } from '../path-menu.js';
import { CtxMenu } from '../CtxMenu.jsx';

// xterm needs literal values (CSS vars won't resolve inside its canvas), so
// the theme is READ from the live tokens at every mount — the terminal
// wears whatever dress the desk wears. Fallbacks are the stock values.
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// impure — one DOM read per token at mount, never per frame
const tokenHex = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return HEX_RE.test(v) ? v : fallback;
};
// pure — hex → rgba string for xterm's selection layer
const rgbaOf = (hex, a) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;
// pure-ish (DOM reads) — the dress, shaped for xterm
const themeFromDress = () => {
  const ground = tokenHex('--color-void', '#000000');
  const ink = tokenHex('--color-white', '#FFFFFF');
  const trim = tokenHex('--signal', '#5FE9FF');
  const alert = tokenHex('--alert', '#FF5533');
  // Body text sits a step below full ink, as it always has (#c8d0d4 ≈ 80%).
  const mix = (a, b, t) => '#' + [0, 2, 4].map((i) => {
    const x = parseInt(a.slice(1 + i, 3 + i), 16);
    const y = parseInt(b.slice(1 + i, 3 + i), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  }).join('');
  return {
    background: ground,
    foreground: mix(ink, ground, 0.2),
    cursor: trim,
    cursorAccent: ground,
    selectionBackground: rgbaOf(trim, 0.25),
    red: alert, // the stage's own \x1b[31m error lines ride the ALERT register
  };
};

export const TerminalStage = ({ windowId, cwd = null, launch = null }) => {
  const hostRef = useRef(null);
  // The shell opens in the window's focus folder AS OF MOUNT; a later focus
  // change must never restart a live shell, so the first value is pinned.
  // The launch id pins the same way — it is the process this window runs.
  const initialCwd = useRef(cwd).current;
  const terminalCwdRef = useRef(initialCwd);
  const initialLaunch = useRef(launch).current;
  const socketRef = useRef(null);
  const sendToShell = useCallback((text) => socketRef.current?.send(text), []);
  const dictation = useTerminalDictation(sendToShell);
  const [linkMenu, setLinkMenu] = useState(null);
  const [linkError, setLinkError] = useState(null);
  const openLink = useCallback(async (kind, url) => {
    setLinkMenu(null);
    setLinkError(null);
    try {
      if (kind === 'integrated' && window.neuma?.browser?.open) {
        const result = await window.neuma.browser.open(url);
        if (!result?.opened) throw new Error(result?.reason || 'the integrated browser refused the URL');
        return;
      }
      if (kind === 'external' && window.neuma?.openExternal) {
        const result = await window.neuma.openExternal(url);
        if (!result?.ok) throw new Error('the external browser refused the URL');
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err) {
      setLinkError(err.message || 'the browser could not open the URL');
    }
  }, []);
  const openDoor = useCallback((door) => {
    if (door.kind === 'url') return openLink('integrated', door.value);
    return openPathDoor(terminalPathFor(door.value, terminalCwdRef.current));
  }, [openLink, initialCwd]);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: themeFromDress(),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try { fit.fit(); } catch { /* zero-size at mount — the observer will fit */ }
    const linkProvider = term.registerLinkProvider({
      provideLinks: (y, answer) => {
        const text = term.buffer.active.getLine(y - 1)?.translateToString(true) || '';
        answer(doorsIn(text).map((door) => ({
          range: { start: { x: door.start + 1, y }, end: { x: door.end, y } },
          text: door.value,
          activate: (event) => { if (event.ctrlKey || event.metaKey) openDoor(door); },
        })));
      },
    });
    const linkAtPointer = (event) => {
      const rect = term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
      const cell = terminalCellAt({ clientX: event.clientX, clientY: event.clientY, rect, cols: term.cols, rows: term.rows });
      if (!cell) return null;
      const line = term.buffer.active.getLine(term.buffer.active.viewportY + cell.y - 1);
      return doorAt(line?.translateToString(true) || '', cell.x);
    };
    const onLinkMenu = (event) => {
      const door = linkAtPointer(event);
      if (!door) return;
      event.preventDefault();
      event.stopPropagation();
      if (door.kind === 'path') openPathMenu(terminalPathFor(door.value, terminalCwdRef.current), event.clientX, event.clientY);
      else setLinkMenu({ url: door.value, at: { x: event.clientX, y: event.clientY } });
    };
    const onLinkClick = (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
      const door = linkAtPointer(event);
      if (!door) return;
      event.preventDefault();
      event.stopPropagation();
      openDoor(door);
    };
    hostRef.current.addEventListener('contextmenu', onLinkMenu);
    hostRef.current.addEventListener('click', onLinkClick, true);

    // A socket that dies without an error/exit frame (auth refusal, backend
    // restart, dropped upgrade) must not read as a live terminal — a black
    // void is the one failure a witness cannot act on. AND a dropped socket
    // no longer kills what ran inside it (friction-map D3): the terminal id
    // survives server-side, the stage auto-reattaches with it, and the
    // buffered scrollback replays. Bounded retries — past them, the honest
    // dead-terminal notice stands.
    let live = true;
    let socket = null;
    let reconnectTimer = null;
    let retries = 0;
    let session = null;
    let ended = false;
    let closeRequested = false;
    const termIdRef = { current: null };
    const MAX_RECONNECTS = 5;

    const connect = () => {
      if (!live || ended) return;
      if (sessionStorage.getItem('authToken') !== session.token) {
        term.write('\r\n[authentication changed - sign in again to recover this terminal]\r\n');
        return;
      }
      socket = openTerminalSocket({
        token: session.token,
        cwd: initialCwd,
        launch: initialLaunch,
        termId: termIdRef.current,
        onHello: ({ id, attached, cwd }) => {
          termIdRef.current = id;
          if (cwd) terminalCwdRef.current = cwd;
          try { rememberTerminalSession(session, id); }
          catch (err) { term.write(`\r\n[terminal recovery storage failed: ${err.message}]\r\n`); }
          retries = 0;
          if (attached) term.write('\r\n\x1b[2m[reattached — replaying what you missed]\x1b[0m\r\n');
        },
        onData: (d) => term.write(d),
        // The code is produced by the PTY, sent by terminal-manager.js, declared
        // in the socket's own JSDoc and delivered to this callback — and used to
        // be dropped right here, so a crashed agent read exactly like a clean
        // exit (#248). Zero stays dim; anything else is visible, in the same
        // register onError uses, because a non-zero exit IS the error the
        // operator has to act on.
        onExit: (code) => {
          ended = true;
          term.write(code
            ? `\r\n\x1b[31m[process exited - code ${code}]\x1b[0m\r\n`
            : '\r\n\x1b[2m[process exited]\x1b[0m\r\n');
        },
        onError: (m) => {
          ended = true;
          term.write(`\r\n\x1b[31m[${m || 'terminal error'}]\x1b[0m\r\n`);
        },
        onClose: ({ code } = {}) => {
          if (!live) return;
          // Only transport failures retry; auth/process/ownership refusals
          // must remain visible and never turn into a replacement shell.
          // 4003: the shell is the machine's (terminal-routes.js) — a guest is
          // told why, once, instead of watching five reattach attempts fail.
          if (code === 4003) {
            term.write("\r\n\x1b[33m[the terminal runs as this computer's own user, so only its owner or a co-owner can open one]\x1b[0m\r\n");
            return;
          }
          if (!ended && ![1000, 1005, 1008, 1013, 4001].includes(code) && retries < MAX_RECONNECTS) {
            retries += 1;
            term.write(`\r\n\x1b[2m[connection lost — reattaching (${retries}/${MAX_RECONNECTS})…]\x1b[0m\r\n`);
            reconnectTimer = setTimeout(connect, 1000);
            return;
          }
          term.write('\r\n\x1b[2m[connection closed — close and reopen this window]\x1b[0m\r\n');
        },
      });
      socketRef.current = socket;
    };
    readTerminalSession(windowId).then((identity) => {
      if (closeRequested) {
        session = identity;
        termIdRef.current = identity.termId;
        finishClose();
        return;
      }
      if (!live) return;
      session = identity;
      termIdRef.current = identity.termId;
      connect();
    }).catch((err) => { if (live) term.write(`\r\n[${err.message}]\r\n`); });

    const finishClose = () => {
      if (session && sessionStorage.getItem('authToken') !== session.token) {
        socket?.detach();
        return; // A replacement identity cannot close the captured owner's shell.
      }
      socket?.close();
      if (!session) return;
      if (termIdRef.current) {
        closeTerminalSession(session, termIdRef.current).catch((err) => {
          console.warn('Terminal close failed; detached TTL remains in force:', err.message);
        });
      }
      try { forgetTerminalSession(session); }
      catch (err) { console.warn('Terminal identity cleanup failed:', err.message); }
    };
    const unregister = registerTerminalWindow(windowId, () => {
      closeRequested = true;
      live = false;
      clearTimeout(reconnectTimer);
      finishClose();
    });

    const onInput = term.onData((d) => socket?.send(d));
    let holdTimer = null;
    let spaceHolding = false;
    term.attachCustomKeyEventHandler((event) => {
      if (event.code !== 'Space') return true;
      if (event.type === 'keydown') {
        if (event.repeat) {
          if (holdTimer || spaceHolding) {
            event.preventDefault();
            return false;
          }
          return true;
        }
        holdTimer = setTimeout(() => {
          holdTimer = null;
          spaceHolding = true;
          socketRef.current?.send('\x7f');
          dictation.begin();
        }, 300);
        return true;
      }
      if (event.type === 'keyup') {
        clearTimeout(holdTimer);
        holdTimer = null;
        if (spaceHolding) {
          spaceHolding = false;
          dictation.end();
          return false;
        }
      }
      return true;
    });
    window.addEventListener('blur', dictation.end);
    const syncSize = () => {
      try { fit.fit(); } catch { return; }
      socket?.resize(term.cols, term.rows);
    };
    const observer = new ResizeObserver(syncSize);
    const unbindTextSize = bindTerminalTextSize(term, syncSize);
    observer.observe(hostRef.current);
    const initial = setTimeout(syncSize, 150); // after the socket opens + PTY spawns

    return () => {
      live = false;
      unregister();
      clearTimeout(initial);
      clearTimeout(holdTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener('blur', dictation.end);
      observer.disconnect();
      unbindTextSize();
      onInput.dispose();
      linkProvider.dispose();
      hostRef.current?.removeEventListener('contextmenu', onLinkMenu);
      hostRef.current?.removeEventListener('click', onLinkClick, true);
      socketRef.current = null;
      socket?.detach();
      term.dispose();
    };
  }, []);

  const micLabel = dictation.state === 'recording' ? 'LISTENING…'
    : dictation.state === 'transcribing' ? 'TRANSCRIBING…'
      : dictation.state === 'error' ? 'DICTATION ERROR' : 'HOLD TO TALK';
  return (
    <div className="terminal-stage-shell">
      <div className="terminal-tools label-data">
        <button
          type="button"
          className={`terminal-dictate${dictation.state === 'recording' ? ' is-recording' : ''}`}
          aria-pressed={dictation.state === 'recording'}
          title="Hold to dictate into this terminal; release to edit, then press Enter to run"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            dictation.begin();
          }}
          onPointerUp={(event) => { event.preventDefault(); dictation.end(); }}
          onPointerCancel={dictation.end}
          onKeyDown={(event) => {
            if (!['Space', 'Enter'].includes(event.code) || event.repeat) return;
            event.preventDefault();
            dictation.begin();
          }}
          onKeyUp={(event) => {
            if (!['Space', 'Enter'].includes(event.code)) return;
            event.preventDefault();
            dictation.end();
          }}
        >{micLabel}</button>
        <span className="terminal-dictation-preview">
          {dictation.setup ? 'SPEECH SETUP REQUIRED' : dictation.preview}
        </span>
      </div>
      {linkError ? <p className="terminal-link-error label-data" role="alert">{linkError}</p> : null}
      <div className="terminal-stage" ref={hostRef} />
      {linkMenu ? (
        <CtxMenu
          at={linkMenu.at}
          items={TERMINAL_LINK_ITEMS}
          onAct={(id) => openLink(id, linkMenu.url)}
          onClose={() => setLinkMenu(null)}
        />
      ) : null}
    </div>
  );
};
