// ChatsOnes — the ONE-ON-ONES register of the Chats window: one neuma's chats, or every neuma's.
//
// WHOSE CHATS (deus-neuma #29): the window follows the neuma in the stream until the operator picks
// another in its own header; opening one of that neuma's chats brings it into the stream first, so
// the chat opens with the being it belongs to. ALL (#30) lists every neuma's chats together, each
// row naming whose it is, newest first, searched across every lane. Naming in batch (#28) is a job
// with its progress, its time left and CANCEL; the right-click menu carries the batch too (#27).
// NEW CHAT starts with the neuma shown (the stream's own in ALL).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useConsciousness } from './consciousness-context.js';
import { EmptyState } from './empty-state.jsx';
import { ChatBatchItems } from './ChatBatchItems.jsx';
import { ChatSearch } from './ChatSearch.jsx';
import { Select } from './Select.jsx';
import { TitlingProgress } from './TitlingProgress.jsx';
import { useChatSearch } from './use-chat-search.js';
import { useChatSessions } from './use-chat-sessions.js';
import { useAllChats } from './use-all-chats.js';
import { useTitlingJob } from './use-titling-job.js';
import { getChatLabels, setChatLabel } from '../../services/chat-labels.js';
import { getRoster } from '../../utils/companion-data.js';
import { houseMembers } from './house-members.js';
import { sessionLabel } from './stream-chats-view.js';
import { announceChatLabels } from './chat-labels-bus.js';
import { playSound } from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';
import { RefreshGlyph } from './ChatsGlyphs.jsx';

const ALL = 'all';

export const ChatsOnes = ({ council, openStream }) => {
  const { t } = useTranslation('desk');
  const { state: streamState, resumeSession, newSession, activeCompanion, switchCompanion } = useConsciousness();
  const members = houseMembers(getRoster(), activeCompanion).map((row) => row.member);
  // null = follow the stream's neuma; a pick holds until the operator picks again
  const [picked, setPicked] = useState(null);
  const viewed = picked ?? activeCompanion?.neumaId ?? null;
  const all = viewed === ALL;
  const neumaId = all ? null : viewed;
  const memberOf = (id) => members.find((m) => m.neumaId === id) || (id === activeCompanion?.neumaId ? activeCompanion : null);

  const [labels, setLabels] = useState({});       // {"<neumaId>:<sessionId>": "name"}
  const [activeId, setActiveId] = useState(null);  // the chat being viewed
  const one = useChatSessions(all ? null : neumaId);
  const oneSearch = useChatSearch(neumaId, one.sessions, labels, !all, activeId);
  const every = useAllChats(members, labels, all);
  const sessions = all ? every.sessions : one.sessions;
  const sessionsError = all ? every.error : one.error;
  const search = all ? every.search : oneSearch;
  const [renaming, setRenaming] = useState(null);  // {neumaId, id} being renamed
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState(null);          // popover: row { row, x, y } or batch { batch, x, y }
  const menuRef = useRef(null);
  const renameRef = useRef(null);
  // an opened rename takes the focus, so typing goes straight into it
  useEffect(() => { if (renaming) renameRef.current?.focus(); }, [renaming]);

  const refreshLabels = useCallback(async () => {
    const l = await getChatLabels();
    setLabels(l);
    announceChatLabels(l); // the stream's title line and rail follow
  }, []);
  const titling = useTitlingJob(refreshLabels, ['CHAT', 'CHATS']);
  const refreshOne = one.refresh;
  const refreshEvery = every.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([all ? refreshEvery() : refreshOne(), refreshLabels()]);
  }, [all, refreshEvery, refreshOne, refreshLabels]);
  useEffect(() => { refresh(); }, [refresh]);

  // The list tracks LIVE turns: a chat that completes lands on the shelf without a refresh.
  const turnInFlight = (streamState?.messages || []).some((m) => m.streaming);
  const wasInFlight = useRef(false);
  useEffect(() => {
    if (wasInFlight.current && !turnInFlight) refresh();
    wasInFlight.current = turnInFlight;
  }, [turnInFlight, refresh]);

  const rowNeuma = (row) => row.neumaId ?? neumaId;
  const keyOf = (row) => `${rowNeuma(row)}:${row.id}`;

  // A chat of another neuma brings that neuma into the stream first; a one-on-one always opens in
  // the one-on-one view, never behind a council's (#25).
  const bringIn = async (id) => {
    const member = memberOf(id);
    if (member && member.neumaId !== activeCompanion?.neumaId) await switchCompanion(member);
    council.leaveRoom();
    return member;
  };
  const onResume = async (row) => {
    playSound('menuOpen');
    setActiveId(row.id);
    const member = await bringIn(rowNeuma(row));
    await resumeSession({ neumaId: rowNeuma(row), companionName: member?.name || 'Unknown', sessionId: row.id });
    openStream();
  };
  const onNew = async () => {
    playSound('confirm');
    setActiveId(null);
    if (!all && neumaId) await bringIn(neumaId);
    else council.leaveRoom();
    newSession();
    openStream();
  };

  const startRename = (row) => { uiSound('open'); setNote(''); setRenaming({ neumaId: rowNeuma(row), id: row.id }); setDraft(labels[keyOf(row)] || ''); };
  const cancelRename = () => { uiSound('close'); setRenaming(null); };
  const saveRename = async () => {
    uiSound('activate');
    setNote('');
    try {
      const updated = await setChatLabel(renaming.neumaId, renaming.id, draft);
      setLabels(updated);
      announceChatLabels(updated);
      setRenaming(null);
    } catch (e) { setNote(e.message); }
  };

  const openMenu = (e, row) => { e.preventDefault(); uiSound('open'); setMenu({ row, x: e.clientX, y: e.clientY }); };
  const openTitleMenu = (e) => { uiSound('open'); setMenu({ batch: true, x: e.clientX, y: e.clientY }); };

  // The conduit names chats from what was said: one chat, or the shelf in batch (force retitles
  // even chats already named). In ALL the batch runs every neuma, each through its own route.
  const runAutotitle = ({ row = null, force = false } = {}) => {
    if (titling.running) return;
    uiSound('activate');
    setNote('');
    titling.start(row
      ? { kind: 'chats', neumaIds: [rowNeuma(row)], sessionIds: [row.id], force: true }
      : { kind: 'chats', neumaIds: all ? members.map((m) => m.neumaId) : [neumaId], force });
  };

  // Dismiss the right-click menu on any interaction outside it, or Escape; inside it, the
  // browser's own context menu stays shut.
  useEffect(() => {
    if (!menu) return undefined;
    const inside = (e) => Boolean(menuRef.current?.contains(e.target));
    const close = (e) => { if (!inside(e)) setMenu(null); };
    const keepShut = (e) => { if (inside(e)) e.preventDefault(); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    const onResize = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('contextmenu', keepShut);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('contextmenu', keepShut);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const whose = [
    { value: ALL, label: 'ALL NEUMA' },
    ...members.map((m) => ({ value: m.neumaId, label: `${String(m.name || m.neumaId).toUpperCase()}${m.neumaId === activeCompanion?.neumaId ? ' · IN THE STREAM' : ''}` })),
  ];
  const shown = note || titling.note;

  return (
    <>
      <div className="chats-head">
        {members.length > 1 ? (
          <Select value={viewed || ''} options={whose} ariaLabel="Whose chats" className="chats-whose"
            onChange={(value) => { uiSound('tick'); setActiveId(null); setPicked(value === activeCompanion?.neumaId ? null : value); }} />
        ) : null}
        <button type="button" className="chats-new" onClick={onNew}>{t('stream.newChatRail')}</button>
        <button type="button" className="chats-new" onClick={openTitleMenu} disabled={titling.running} title="Name chats from what was said">
          {titling.running ? 'NAMING…' : 'TITLE'}
        </button>
        <button type="button" className="chats-refresh" onClick={() => { uiSound('tick'); refresh(); }} aria-label="Refresh chats">
          <RefreshGlyph />
        </button>
      </div>
      <TitlingProgress titling={titling} />

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
          {search.rows.map((row) => (
            <li key={keyOf(row)} className="chats-rowwrap">
              {renaming?.id === row.id && renaming.neumaId === rowNeuma(row) ? (
                <div className="chats-rename">
                  <input
                    ref={renameRef} className="chats-rename-input" value={draft} aria-label="Chat name"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') cancelRename(); }}
                    placeholder={sessionLabel(row.id)} spellCheck={false}
                  />
                  <button type="button" className="chats-rename-go" onClick={saveRename}>SAVE</button>
                  <button type="button" className="chats-rename-x" onClick={cancelRename}>CANCEL</button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`chats-row${row.id === activeId ? ' is-live' : ''}`}
                  onClick={() => onResume(row)}
                  onContextMenu={(e) => openMenu(e, row)}
                  aria-current={row.id === activeId}
                  title="Right-click for options"
                >
                  <span className="chats-row-mark" aria-hidden="true" />
                  <span className="chats-row-label label-data">{labels[keyOf(row)] || sessionLabel(row.id)}</span>
                  {all ? <span className="chats-row-whose label-data">{String(row.name).toUpperCase()}</span> : null}
                  <span className="chats-row-id">{labels[keyOf(row)] ? sessionLabel(row.id) : row.id}</span>
                  {row.excerpt ? <span className="chat-content-excerpt">{row.excerpt}</span> : null}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {shown ? <div className="chats-note label-data" role="status">{shown}</div> : null}

      {menu ? createPortal(
        <div
          ref={menuRef}
          className="chats-ctx"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 230) }}
        >
          {menu.batch ? (
            <ChatBatchItems itemClass="chats-ctx-item" titling={titling.running} onRun={(opts) => { runAutotitle(opts); setMenu(null); }} />
          ) : (
            <>
              <button type="button" className="chats-ctx-item" onClick={() => { onResume(menu.row); setMenu(null); }}>OPEN</button>
              <button type="button" className="chats-ctx-item" onClick={() => { startRename(menu.row); setMenu(null); }}>RENAME</button>
              <button type="button" className="chats-ctx-item" disabled={titling.running} onClick={() => { runAutotitle({ row: menu.row }); setMenu(null); }}>AUTO-TITLE</button>
              <ChatBatchItems itemClass="chats-ctx-item" separatorClass="chats-ctx-sep" titling={titling.running} onRun={(opts) => { runAutotitle(opts); setMenu(null); }} />
            </>
          )}
        </div>,
        document.body
      ) : null}
    </>
  );
};
