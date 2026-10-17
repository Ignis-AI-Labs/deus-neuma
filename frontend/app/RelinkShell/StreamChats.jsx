// StreamChats — the stream's quick chat list, a second rail beside the tasks.
//
// Design note, 2026-08-15: […] So: the TASKS rail's exact idiom — a
// spine that unfolds — holding this being's one-on-one chats, newest first,
// the bound one marked. A row resumes that sitting in place; + NEW CHAT
// replaces the screen the way the composer's button does; the full CHATS
// window (councils, batch retitling, pinning) stays one door away. Reading,
// switching, and NAMING live here now (Design note, 2026-09-18: right-click a row
// to rename it by hand or let the conduit name it from what was said, and
// TITLE names the whole untitled shelf in one stroke.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import './StreamChats.css';
import { useConsciousness } from './consciousness-context.js';
import { useWindows } from '../windowing/use-windows.js';
import { ChatSearch } from './ChatSearch.jsx';
import { useChatSearch } from './use-chat-search.js';
import { autotitleChats, listSessions } from './workspace-sessions.js';
import { getChatLabels, setChatLabel } from '../../services/chat-labels.js';
import { chatRows, rowTip, tipPlacement } from './stream-chats-view.js';
import { CHAT_LABELS_EVENT, announceChatLabels } from './chat-labels-bus.js';
import { setOpenRail } from './stream-rail-state.js';
import { useRailItem } from './StreamRail.jsx';
import { useSettled } from './use-settled.js';
import { RailGlyph } from './RailGlyph.jsx';
import { playSound } from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';

export const StreamChats = () => {
  const { activeCompanion, resumeSession, newSession, wsService, state } = useConsciousness() || {};
  const windows = useWindows();
  const { t } = useTranslation('desk');
  const neumaId = activeCompanion?.neumaId || null;
  const companionName = activeCompanion?.name || 'Unknown';

  // This rail publishes a BUTTON to the one shared strip and draws only its
  // panel; the strip tracks which rail is open on everyone's behalf. `show`
  // follows neumaId, so with no being bound the button withdraws instead of
  // offering a chat list that cannot exist (Design note, 2026-08-25.
  const isOpen = useRailItem('chats', { label: t('stream.railChats'), show: Boolean(neumaId), title: t('stream.railChatsTitle') });
  // The list is read only while this rail is the open one — folding it stops
  // the refreshes, exactly as the collapsed flag used to.
  const collapsed = !isOpen;
  // THE HOVER TIP. A rail this narrow truncates long names by construction, so
  // the full name has to be reachable without opening the chat (Founder,
  // 2026-08-25). It rides a fixed layer rather than the row's own box: the
  // rail is a scroller and clips its overflow, so a tip drawn inside it would
  // be cut off exactly for the rows nearest the edges.
  //
  // …and that layer is PORTALLED to the body, not merely `position: fixed` in
  // place. A transformed ancestor becomes the containing block for a fixed
  // child, and the stream has one — measured, the tip landed 1346px down a
  // 720px viewport before the portal (stream-chats.spec caught it).
  const [tip, setTip] = useState(null); // {text, top, right} | null
  const showTip = (event, row) => setTip({
    text: rowTip(row),
    ...tipPlacement(event.currentTarget.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight }),
  });

  // The bound chat, straight from the socket (StreamTasks' law: the portal
  // owns the binding and announces every change — follow, never guess).
  const [chatId, setChatId] = useState(() => wsService?.getSessionState?.()?.sessionId ?? null);
  useSettled(() => {
    if (!wsService) return undefined;
    setChatId(wsService.getSessionState?.()?.sessionId ?? null);
    const onState = (s) => setChatId(s?.sessionId ?? null);
    wsService.on('session:state', onState);
    return () => wsService.off('session:state', onState);
  }, [wsService]);

  const [sessions, setSessions] = useState(null); // null = loading
  const [labels, setLabels] = useState({});
  // Naming, in the operator's two registers: the conduit names from what was
  // said (AUTO-TITLE / TITLE), the operator names by hand (RENAME). `menu`
  // holds a row menu { id, x, y } or the batch menu { batch: true, x, y };
  // `note` carries a naming run's verdict; `renaming` is the chat being
  // renamed, `draft` its editor's text.
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');
  const [titling, setTitling] = useState(false);
  const [note, setNote] = useState('');
  const refresh = useCallback(async (settled) => {
    if (!neumaId) { setSessions([]); return; }
    const [s, l] = await Promise.all([listSessions(neumaId), getChatLabels()]);
    if (settled?.()) return;
    setSessions(s);
    setLabels(l);
  }, [neumaId]);
  useSettled((settled) => { if (!collapsed) refresh(settled); }, [refresh, collapsed]);

  // A chat that completes its first turn lands on the list without a manual
  // refresh (the ChatsApp precedent, witnessed 2026-07-21).
  const turnInFlight = (state?.messages || []).some((m) => m.streaming);
  const wasInFlight = useRef(false);
  useSettled((settled) => {
    if (wasInFlight.current && !turnInFlight && !collapsed) refresh(settled);
    wasInFlight.current = turnInFlight;
    return undefined;
  }, [turnInFlight, refresh, collapsed]);

  // Renames and autotitles ride the labels bus with the fresh map.
  useEffect(() => {
    const onLabels = (e) => { if (e.detail?.labels) setLabels(e.detail.labels); };
    window.addEventListener(CHAT_LABELS_EVENT, onLabels);
    return () => window.removeEventListener(CHAT_LABELS_EVENT, onLabels);
  }, []);

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

  const search = useChatSearch(neumaId, sessions, labels, isOpen, chatId);

  const keyOf = (id) => `${neumaId}:${id}`;

  const startRename = (id) => { uiSound('open'); setNote(''); setRenaming(id); setDraft(labels[keyOf(id)] || ''); };
  const cancelRename = () => { uiSound('close'); setRenaming(null); };
  const saveRename = async (id) => {
    uiSound('activate');
    setNote('');
    try {
      const updated = await setChatLabel(neumaId, id, draft);
      setLabels(updated);
      announceChatLabels(updated); // the stream's title line and ChatsApp follow
      setRenaming(null);
    } catch (e) { setNote(e.message); }
  };

  // The conduit names chats from what was said — one chat, or the whole shelf
  // (force retitles even chats already named; without it, untitled only).
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
    refresh();
  };

  const openMenu = (e, id) => { e.preventDefault(); uiSound('open'); setMenu({ id, x: e.clientX, y: e.clientY }); };
  const openTitleMenu = (e) => { uiSound('open'); setMenu({ batch: true, x: e.clientX, y: e.clientY }); };

  if (!neumaId) return null;

  // Folded is NOTHING, not a spine — the strip carries this rail's button
  // whether it is open or shut.
  if (!isOpen) return null;

  const all = chatRows(sessions || [], labels, neumaId, chatId);
  const rows = search.rows;
  return (
    <aside className="stream-chats cham" aria-label="Chats">
      <div className="stream-chats-in cham-in">
        <header className="stream-chats-head">
          <span className="stream-chats-title label-data">CHATS</span>
          <button
            type="button"
            className="stream-chats-fold"
            onClick={() => { uiSound('close'); setOpenRail(null); }}
            title="Fold the rail away"
            aria-expanded
          >
            <RailGlyph open />
          </button>
        </header>

        <div className="stream-chats-actions">
          <button
            type="button"
            className="stream-chats-new label-data"
            onClick={() => { playSound('confirm'); newSession(); }}
          >
            {t('stream.newChatRail')}
          </button>
          <button
            type="button"
            className="stream-chats-new label-data"
            onClick={openTitleMenu}
            disabled={titling}
            title="Name chats from what was said"
          >
            {titling ? 'NAMING…' : 'TITLE'}
          </button>
        </div>

        <ChatSearch search={search} />

        {sessions === null ? (
          <p className="stream-chats-empty label-data">READING…</p>
        ) : all.length === 0 ? (
          <p className="stream-chats-empty label-data">NO CHATS YET</p>
        ) : rows.length === 0 && (search.loading || search.error) ? null : rows.length === 0 ? (
          <p className="stream-chats-empty label-data">NO CHAT MATCHES</p>
        ) : (
          <ul className="stream-chats-list">
            {rows.map((r) => (
              <li key={r.id}>
                {renaming === r.id ? (
                  <div className="stream-chats-rename">
                    <input
                      className="stream-chats-rename-input" autoFocus value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(r.id); if (e.key === 'Escape') cancelRename(); }}
                      placeholder={r.full} spellCheck={false}
                    />
                    <button type="button" className="stream-chats-rename-go" onClick={() => saveRename(r.id)}>SAVE</button>
                    <button type="button" className="stream-chats-rename-x" onClick={cancelRename}>CANCEL</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`stream-chats-row${r.excerpt ? ' has-content-match' : ''}${r.live ? ' is-live' : ''}`}
                    aria-current={r.live}
                    onMouseEnter={(e) => showTip(e, r)}
                    onFocus={(e) => showTip(e, r)}
                    onMouseLeave={() => setTip(null)}
                    onBlur={() => setTip(null)}
                    onClick={() => {
                      if (r.live) return; // already on screen — a no-op, not a reload
                      playSound('menuOpen');
                      resumeSession({ neumaId, companionName, sessionId: r.id });
                    }}
                    onContextMenu={(e) => openMenu(e, r.id)}
                    title="Right-click for options"
                  >
                    <span className="stream-chats-mark" aria-hidden="true" />
                    <span className="stream-chats-label label-data">{r.label}</span>
                    {r.named ? <span className="stream-chats-stamp label-data">{r.stamp}</span> : null}
                    {r.excerpt ? <span className="chat-content-excerpt">{r.excerpt}</span> : null}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {note ? <div className="stream-chats-note label-data">{note}</div> : null}

        <footer className="stream-chats-foot">
          <button
            type="button"
            className="stream-chats-editor label-data"
            onClick={() => { uiSound('activate'); windows?.dispatch?.({ type: 'OPEN', id: 'chats' }); }}
          >
            OPEN CHATS
          </button>
        </footer>
      </div>

      {tip ? createPortal(
        <div className="stream-chats-tip label-data" role="tooltip" style={{ top: tip.top, right: tip.right }}>
          {tip.text}
        </div>,
        document.body,
      ) : null}

      {menu ? createPortal(
        <div
          className="stream-chats-ctx"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 150) }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.batch ? (
            <>
              <button type="button" className="stream-chats-ctx-item" disabled={titling} onClick={() => { runAutotitle({ force: false }); setMenu(null); }}>TITLE UNTITLED</button>
              <button type="button" className="stream-chats-ctx-item" disabled={titling} onClick={() => { runAutotitle({ force: true }); setMenu(null); }}>RETITLE ALL</button>
            </>
          ) : (
            <>
              <button type="button" className="stream-chats-ctx-item" disabled={titling} onClick={() => { startRename(menu.id); setMenu(null); }}>RENAME</button>
              <button type="button" className="stream-chats-ctx-item" disabled={titling} onClick={() => { runAutotitle({ sessionIds: [menu.id], force: true }); setMenu(null); }}>AUTO-TITLE</button>
            </>
          )}
        </div>,
        document.body
      ) : null}
    </aside>
  );
};
