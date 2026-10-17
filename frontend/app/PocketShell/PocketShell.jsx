// PocketShell — Neuma in a pocket: one pane at a time, the same stream.
//
// A phone reaching the desk over the tailnet (docs/security/remote-surface.md)
// gets this shell instead of the floating-window desk. It stands up the
// SAME providers RelinkShell stands up for the stream — the consciousness
// stream, the council, the context composition, the projects — and a stub
// in place of the window manager, so every stream component renders here
// unmodified. Navigation is a bottom bar in the data register; the rails the
// desk pins beside the stream (chats, tasks) are panes of their own here.
import { useEffect, useState } from 'react';
import { useConsciousnessStream } from '../RelinkShell/use-consciousness-stream.js';
import { ConsciousnessProvider } from '../RelinkShell/consciousness-context.js';
import { useCouncilStream } from '../RelinkShell/use-council-stream.js';
import { CouncilContext } from '../RelinkShell/council-context.js';
import { useContextComposition } from '../RelinkShell/use-context-composition.js';
import { CompositionContext } from '../RelinkShell/composition-context.js';
import { ProjectContext } from '../RelinkShell/projects/project-context.js';
import { useProjectsState } from '../RelinkShell/projects/use-projects.js';
import { WindowContext } from '../windowing/WindowManager.jsx';
import { openCompanionLink } from '../relink-link.js';
import { useReconnectReload } from '../RelinkShell/use-reconnect-reload.js';
import { usePocketWake } from './use-pocket-wake.js';
import { wantsWakeLock } from './pocket-wake.js';
import { PocketStream } from './PocketStream.jsx';
import { PocketRail } from './PocketRails.jsx';
import { PocketSettings } from './PocketSettings.jsx';
import { PocketDreams } from './PocketDreams.jsx';
import { PANES, openingOf } from './pocket-opening.js';
import '../RelinkShell/RelinkShell.css';
import '../RelinkShell/StreamTasks.css';
import '../RelinkShell/StreamChats.css';
import './PocketShell.css';

// The desk's windows do not exist here. The two stream pieces that reach for
// the window manager (AttachMenu opening FILES, TeamRunChip opening WORKFLOW)
// get a dispatcher that does nothing, and stay otherwise unmodified.
const WINDOW_STUB = Object.freeze({
  registry: Object.freeze({}),
  state: Object.freeze({ windows: [], focusedId: null }),
  dispatch: () => {},
});

/**
 * The head's one-word account of the link. Pure.
 * @param {{ connected: boolean, thinking: boolean }} state
 * @returns {string}
 */
export const linkWord = ({ connected, thinking }) => {
  if (!connected) return 'RELINKING…';
  return thinking ? 'WORKING' : 'LINKED';
};

export const PocketShell = ({ wsService }) => {
  const projects = useProjectsState();
  const consciousness = useConsciousnessStream(wsService, {
    focus: null,
    projects: projects.projects,
    onProjectChatCreated: projects.refresh,
  });
  const neumaId = consciousness.activeCompanion?.neumaId ?? null;
  const composition = useContextComposition(wsService, neumaId);
  const council = useCouncilStream(wsService, { focus: null, projects: projects.projects });
  // Read once: the ask in the address is consumed, so a reload never re-records.
  const [opening] = useState(() => openingOf(typeof window !== 'undefined' ? window.location.search : ''));
  const [pane, setPane] = useState(opening.pane);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('pane') && !url.searchParams.has('record')) return;
    url.searchParams.delete('pane');
    url.searchParams.delete('record');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  // The screen stays awake while the being works for this phone or waits on
  // its answer — a timeout mid-turn kills the socket and denies the card.
  usePocketWake(wantsWakeLock(consciousness.state));

  // The link is opened HERE, as the desk does on mount (RelinkShell): bind
  // this surface to its companion and connect the socket if it is cold. The
  // desk also connects from each chat window's host; a pocket has none.
  useEffect(() => {
    openCompanionLink(wsService);
  }, [wsService]);

  // A phone's screen lock kills the socket while the being keeps working:
  // on the way back, read what settled, and keep looking until it does.
  useReconnectReload(wsService, {
    resumeSession: consciousness.resumeSession,
    messages: consciousness.state.messages,
  });

  // Choosing a chat, or a new one, is a navigation: the stream is where it lands.
  useEffect(() => {
    const toStream = () => setPane('stream');
    wsService.on('portal:navigation-start', toStream);
    return () => wsService.off('portal:navigation-start', toStream);
  }, [wsService]);

  const { state, activeCompanion } = consciousness;

  return (
    <ConsciousnessProvider value={consciousness}>
      <CouncilContext.Provider value={council}>
        <CompositionContext.Provider value={composition}>
          <ProjectContext.Provider value={projects}>
            <WindowContext.Provider value={WINDOW_STUB}>
              <div className="pocket">
                <header className="pocket-head">
                  <span className="relink-dot" data-live={String(Boolean(state.connected))} />
                  <span className="pocket-head-name label-data">{(activeCompanion?.name || 'NEUMA').toUpperCase()}</span>
                  <span className="pocket-head-state label-data">{linkWord(state)}</span>
                </header>
                <main className="pocket-pane">
                  {pane === 'stream' ? <PocketStream /> : null}
                  {pane === 'chats' || pane === 'tasks' ? <PocketRail which={pane} /> : null}
                  {pane === 'dreams' ? <PocketDreams autoRecord={opening.record} /> : null}
                  {pane === 'me' ? <PocketSettings /> : null}
                </main>
                <nav className="pocket-nav" aria-label="Pocket navigation">
                  {PANES.map(([id, label]) => (
                    <button
                      type="button"
                      key={id}
                      className="pocket-nav-btn label-data"
                      aria-current={pane === id ? 'page' : undefined}
                      onClick={() => setPane(id)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              </div>
            </WindowContext.Provider>
          </ProjectContext.Provider>
        </CompositionContext.Provider>
      </CouncilContext.Provider>
    </ConsciousnessProvider>
  );
};
