// ChatsApp — the Chats browser as a desk window, in two registers.
//
// ONE-ON-ONES lists the active neuma's workspace sessions (each = one
// chat), newest first. Selecting a chat resumes it: the portal binds to
// that session and its turns load into the STREAM window. NEW CHAT severs
// the bound session so the next message starts fresh. v1 scope is the
// active neuma; resuming another roster neuma is a later cycle.
//
// COUNCILS is the separate shelf — group sittings are the ROOM's record,
// never mixed among the one-on-ones. Selecting one reopens the council in
// its full format (the stream window switches into the room, exchange
// restored). The two registers are tabs of one history: switch, load, go.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import './ChatsApp.css';
import { useConsciousness } from './consciousness-context.js';
import { DeskTabs } from './DeskTabs.jsx';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useWindows } from '../windowing/use-windows.js';
import { autotitleChats } from './workspace-sessions.js';
import { ChatSearch } from './ChatSearch.jsx';
import { useChatSearch } from './use-chat-search.js';
import { useChatSessions } from './use-chat-sessions.js';
import { getChatLabels, setChatLabel } from '../../services/chat-labels.js';
import { getCouncilLabels, setCouncilLabel, autotitleCouncils } from '../../services/council-labels.js';
import { formatDateTime } from '../../utils/format.js';
import { sessionLabel } from './stream-chats-view.js';
import { announceChatLabels } from './chat-labels-bus.js';
import { useCouncil } from './council-context.js';

import { playSound } from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';

const ChatsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 2.5 H14 V9 H7 L4 11.5 V9 H2 Z" />
    <path d="M4.5 5 H11.5 M4.5 6.8 H9" />
  </svg>
);

const RefreshGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M13 8 A5 5 0 1 1 11.5 4.4" />
    <path d="M11.5 1.5 V4.6 H8.4" />
  </svg>
);

// One closed sitting on the COUNCILS register — who sat, what it was about,
// one click to reopen the room whole. The conduit can name sittings from what
// was deliberated (batch or one at a time); under a named sitting the roster
// always rides as the subsection line.
const CouncilsRegister = ({ council, openStream }) => {
  // The shelf loads when this register is shown.
  useEffect(() => { council.listCouncils(); }, [council.listCouncils]);

  const [labels, setLabels] = useState({});    // { "<councilId>": "name" }
  const [titling, setTitling] = useState(false);
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState(null);      // popover: row { id, x, y } or batch { batch, x, y }
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');

  useEffect(() => { getCouncilLabels().then(setLabels); }, []);

  const memberNames = (c) =>
    (Array.isArray(c.members) ? c.members : [])
      .map((m) => m.name || m.neumaId)
      .filter(Boolean)
      .join(' · ')
      .toUpperCase() || c.councilId;

  const onReopen = (councilId) => {
    playSound('confirm');
    council.resumeCouncil(councilId);
    openStream();
  };

  // The conduit names councils from what was deliberated — one sitting, or
  // the whole shelf in batch (force retitles even sittings already named).
  const runAutotitle = async ({ councilIds, force = false } = {}) => {
    if (titling) return;
    uiSound('activate');
    setTitling(true);
    setNote(councilIds ? 'NAMING COUNCIL…' : 'NAMING COUNCILS…');
    const { results, labels: updated } = await autotitleCouncils({ councilIds, force });
    if (updated) setLabels(updated);
    const titled = results.filter((r) => r.status === 'titled').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    setNote(
      results.length === 0 ? 'NOTHING TO NAME'
        : failed > 0 ? `NAMED ${titled} · ${failed} FAILED`
          : titled === 0 ? 'NOTHING NAMED'
            : `NAMED ${titled} ${titled === 1 ? 'COUNCIL' : 'COUNCILS'}`
    );
    setTitling(false);
  };

  const startRename = (id) => { uiSound('open'); setNote(''); setRenaming(id); setDraft(labels[id] || ''); };
  const cancelRename = () => { uiSound('close'); setRenaming(null); };
  const saveRename = async (id) => {
    // A rename mid-batch would race the batch's write for the same council —
    // last-writer-wins on the atomic file, so hold renames until it lands.
    if (titling) { setNote('NAMING IN PROGRESS — HOLD THE RENAME'); return; }
    uiSound('activate');
    setNote('');
    try {
      setLabels(await setCouncilLabel(id, draft));
      setRenaming(null);
    } catch (e) { setNote(e.message); }
  };

  // Dismiss the right-click menu on any outside interaction or Escape.
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const past = council.state.past;
  return (
    <>
      <div className="chats-head">
        <button
          type="button" className="chats-new"
          onClick={(e) => { uiSound('open'); setMenu({ batch: true, x: e.clientX, y: e.clientY }); }}
          disabled={titling} title="Name councils from what was deliberated"
        >
          {titling ? 'NAMING…' : 'TITLE'}
        </button>
        <button type="button" className="chats-refresh" onClick={() => { uiSound('tick'); council.listCouncils(); }} aria-label="Refresh councils">
          <RefreshGlyph />
        </button>
      </div>

      {past.length === 0 ? (
        <EmptyState title="NO COUNCILS YET — CONVENE ONE FROM THE STREAM'S COUNCIL VIEW OR THE HOUSE" />
      ) : (
        <ul className="chats-list">
          {past.map((c) => (
            <li key={c.councilId} className="chats-rowwrap">
              {renaming === c.councilId ? (
                <div className="chats-rename">
                  <input
                    className="chats-rename-input" autoFocus value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(c.councilId); if (e.key === 'Escape') cancelRename(); }}
                    placeholder={memberNames(c)} spellCheck={false}
                  />
                  <button type="button" className="chats-rename-go" onClick={() => saveRename(c.councilId)}>SAVE</button>
                  <button type="button" className="chats-rename-x" onClick={cancelRename}>CANCEL</button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`chats-row${council.state.councilId === c.councilId ? ' is-live' : ''}`}
                  onClick={() => onReopen(c.councilId)}
                  onContextMenu={(e) => { e.preventDefault(); uiSound('open'); setMenu({ id: c.councilId, x: e.clientX, y: e.clientY }); }}
                  aria-current={council.state.councilId === c.councilId}
                  title="Right-click for options"
                >
                  <span className="chats-row-mark" aria-hidden="true" />
                  <span className="chats-row-label label-data">{labels[c.councilId] || memberNames(c)}</span>
                  <span className="chats-row-id">
                    {labels[c.councilId] ? `${memberNames(c)} · ${formatDateTime(c.lastAt)}` : formatDateTime(c.lastAt)}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {note ? <div className="chats-note label-data">{note}</div> : null}

      {menu ? createPortal(
        <div
          className="chats-ctx"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 150) }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.batch ? (
            <>
              <button type="button" className="chats-ctx-item" onClick={() => { runAutotitle({ force: false }); setMenu(null); }}>TITLE UNTITLED</button>
              <button type="button" className="chats-ctx-item" onClick={() => { runAutotitle({ force: true }); setMenu(null); }}>RETITLE ALL</button>
            </>
          ) : (
            <>
              <button type="button" className="chats-ctx-item" onClick={() => { onReopen(menu.id); setMenu(null); }}>REOPEN</button>
              <button type="button" className="chats-ctx-item" disabled={titling} onClick={() => { startRename(menu.id); setMenu(null); }}>RENAME</button>
              <button type="button" className="chats-ctx-item" disabled={titling} onClick={() => { runAutotitle({ councilIds: [menu.id], force: true }); setMenu(null); }}>AUTO-TITLE</button>
            </>
          )}
        </div>,
        document.body
      ) : null}
    </>
  );
};

const ChatsBody = () => {
  // Identity from the reactive context — THIS window's binding (F-01). A
  // switch in a sibling window must never repoint the chats list, and a
  // switch here re-renders it.
  const { t } = useTranslation('desk');
  const { state: streamState, resumeSession, newSession, activeCompanion } = useConsciousness();
  const { dispatch } = useWindows();
  const council = useCouncil();
  // Which register of the history is showing: 'ones' | 'councils'.
  const [tab, setTab] = useState('ones');
  const neumaId = activeCompanion?.neumaId || null;
  const companionName = activeCompanion?.name || 'Unknown';
  const { sessions, error: sessionsError, refresh: refreshSessions } = useChatSessions(neumaId);
  const [labels, setLabels] = useState({});       // {"<neumaId>:<sessionId>": "name"}
  const [activeId, setActiveId] = useState(null);  // the chat being viewed
  const search = useChatSearch(neumaId, sessions, labels, tab === 'ones', activeId);
  const [renaming, setRenaming] = useState(null);  // session id being renamed
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState(null);          // popover: row { id, x, y } or batch { batch, x, y }
  const [titling, setTitling] = useState(false);   // a naming run is in flight

  const refresh = useCallback(async () => {
    const [, l] = await Promise.all([refreshSessions(), getChatLabels()]);
    setLabels(l);
  }, [refreshSessions]);

  const keyOf = (id) => `${neumaId}:${id}`;
  const displayLabel = (id) => labels[keyOf(id)] || sessionLabel(id);

  useEffect(() => { refresh(); }, [refresh]);

  // The list tracks LIVE turns: a chat that completes (the streaming flag
  // settling) lands on the shelf without a manual refresh — otherwise a
  // first-ever conversation reads as NO CHATS YET until the window is
  // reopened (witnessed with the witness lanes, 2026-07-21).
  const turnInFlight = (streamState?.messages || []).some((m) => m.streaming);
  const wasInFlight = useRef(false);
  useEffect(() => {
    if (wasInFlight.current && !turnInFlight) refresh();
    wasInFlight.current = turnInFlight;
  }, [turnInFlight, refresh]);

  const openStream = () => dispatch({ type: 'OPEN', id: 'chat' });

  const onResume = async (id) => {
    playSound('menuOpen');
    setActiveId(id);
    await resumeSession({ neumaId, companionName, sessionId: id });
    openStream();
  };

  const onNew = () => {
    playSound('confirm');
    setActiveId(null);
    newSession();
    openStream();
  };

  const startRename = (id) => { uiSound('open'); setNote(''); setRenaming(id); setDraft(labels[keyOf(id)] || ''); };
  const cancelRename = () => { uiSound('close'); setRenaming(null); };
  const saveRename = async (id) => {
    uiSound('activate');
    setNote('');
    try {
      const updated = await setChatLabel(neumaId, id, draft);
      setLabels(updated);
      announceChatLabels(updated); // the stream's title line and rail follow
      setRenaming(null);
    } catch (e) { setNote(e.message); }
  };

  const openMenu = (e, id) => { e.preventDefault(); uiSound('open'); setMenu({ id, x: e.clientX, y: e.clientY }); };

  // The conduit names chats from what was said — one chat, or the whole
  // one-on-one shelf in batch (force retitles even chats already named).
  const runAutotitle = async ({ sessionIds, force = false } = {}) => {
    if (titling) return;
    uiSound('activate');
    setTitling(true);
    setNote(sessionIds ? 'NAMING CHAT…' : 'NAMING CHATS…');
    const { results, labels: updated } = await autotitleChats(neumaId, { sessionIds, force });
    if (updated) { setLabels(updated); announceChatLabels(updated); }
    const titled = results.filter((r) => r.status === 'titled').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    setNote(
      results.length === 0 ? 'NOTHING TO NAME'
        : failed > 0 ? `NAMED ${titled} · ${failed} FAILED`
          : titled === 0 ? 'NOTHING NAMED'
            : `NAMED ${titled} ${titled === 1 ? 'CHAT' : 'CHATS'}`
    );
    setTitling(false);
  };

  const openTitleMenu = (e) => { uiSound('open'); setMenu({ batch: true, x: e.clientX, y: e.clientY }); };

  // Dismiss the right-click menu on any outside interaction or Escape.
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <div className="chats">
      {/* Two registers of one history — private threads and the rooms. */}
      <DeskTabs items={[{ id: 'ones', label: 'ONE-ON-ONES' }, { id: 'councils', label: 'COUNCILS' }]}
        value={tab} onChange={next => { uiSound('tick'); setTab(next); }} label="Chat registers"
        className="chats-tabs" tabClassName="chats-tab label-data" panelClassName="chats-panel">
      {tab === 'councils' ? (
        <CouncilsRegister council={council} openStream={openStream} />
      ) : (
      <>
      <div className="chats-head">
        <button type="button" className="chats-new" onClick={onNew}>{t('stream.newChatRail')}</button>
        <button
          type="button" className="chats-new" onClick={openTitleMenu}
          disabled={titling} title="Name chats from what was said"
        >
          {titling ? 'NAMING…' : 'TITLE'}
        </button>
        <button type="button" className="chats-refresh" onClick={() => { uiSound('tick'); refresh(); }} aria-label="Refresh chats">
          <RefreshGlyph />
        </button>
      </div>

      <ChatSearch search={search} />

      {sessionsError ? (
        <EmptyState title="CHATS UNREACHABLE" tone="error">
          <small>{sessionsError}</small>
          <button type="button" className="chats-refresh" onClick={refresh}>RETRY</button>
        </EmptyState>
      ) : sessions === null ? (
        <EmptyState title="LOADING…" />
      ) : sessions.length === 0 ? (
        <EmptyState title="NO CHATS YET" />
      ) : search.rows.length === 0 ? (
        search.loading || search.error ? null : <EmptyState title="NO CHAT MATCHES" />
      ) : (
        <ul className="chats-list">
          {search.rows.map(({ id, excerpt }) => (
            <li key={id} className="chats-rowwrap">
              {renaming === id ? (
                <div className="chats-rename">
                  <input
                    className="chats-rename-input" autoFocus value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(id); if (e.key === 'Escape') cancelRename(); }}
                    placeholder={sessionLabel(id)} spellCheck={false}
                  />
                  <button type="button" className="chats-rename-go" onClick={() => saveRename(id)}>SAVE</button>
                  <button type="button" className="chats-rename-x" onClick={cancelRename}>CANCEL</button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`chats-row${id === activeId ? ' is-live' : ''}`}
                  onClick={() => onResume(id)}
                  onContextMenu={(e) => openMenu(e, id)}
                  aria-current={id === activeId}
                  title="Right-click for options"
                >
                  <span className="chats-row-mark" aria-hidden="true" />
                  <span className="chats-row-label label-data">{displayLabel(id)}</span>
                  <span className="chats-row-id">{labels[keyOf(id)] ? sessionLabel(id) : id}</span>
                  {excerpt ? <span className="chat-content-excerpt">{excerpt}</span> : null}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {note ? <div className="chats-note label-data">{note}</div> : null}

      {menu ? createPortal(
        <div
          className="chats-ctx"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 150) }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.batch ? (
            <>
              <button type="button" className="chats-ctx-item" onClick={() => { runAutotitle({ force: false }); setMenu(null); }}>TITLE UNTITLED</button>
              <button type="button" className="chats-ctx-item" onClick={() => { runAutotitle({ force: true }); setMenu(null); }}>RETITLE ALL</button>
            </>
          ) : (
            <>
              <button type="button" className="chats-ctx-item" onClick={() => { onResume(menu.id); setMenu(null); }}>OPEN</button>
              <button type="button" className="chats-ctx-item" onClick={() => { startRename(menu.id); setMenu(null); }}>RENAME</button>
              <button type="button" className="chats-ctx-item" onClick={() => { runAutotitle({ sessionIds: [menu.id], force: true }); setMenu(null); }}>AUTO-TITLE</button>
            </>
          )}
        </div>,
        document.body
      ) : null}
      </>
      )}
      </DeskTabs>
    </div>
  );
};

export const chatsApp = {
  label: 'CHATS',
  labelKey: 'apps.chats',
  icon: <ChatsIcon />,
  title: <AppTitle label="CHATS" labelKey="apps.chats" />,
  Body: ChatsBody,
  storageKey: 'chats',
};
