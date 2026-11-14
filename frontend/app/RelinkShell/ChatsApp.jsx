// ChatsApp — the Chats browser as a desk window, in two registers.
//
// ONE-ON-ONES (ChatsOnes.jsx) lists one neuma's workspace sessions (each =
// one chat), or every neuma's, newest first. Selecting a chat resumes it:
// its neuma comes into the stream, the portal binds to that session and its
// turns load into the STREAM window. NEW CHAT severs the bound session so
// the next message starts fresh.
//
// COUNCILS is the separate shelf — group sittings are the ROOM's record,
// never mixed among the one-on-ones. Selecting one reopens the council in
// its full format (the stream window switches into the room, exchange
// restored). The two registers are tabs of one history: switch, load, go.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './ChatsApp.css';
import { DeskTabs } from './DeskTabs.jsx';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useWindows } from '../windowing/use-windows.js';
import { ChatBatchItems } from './ChatBatchItems.jsx';
import { ChatsOnes } from './ChatsOnes.jsx';
import { RefreshGlyph } from './ChatsGlyphs.jsx';
import { TitlingProgress } from './TitlingProgress.jsx';
import { useTitlingJob } from './use-titling-job.js';
import { getCouncilLabels, setCouncilLabel } from '../../services/council-labels.js';
import { formatDateTime } from '../../utils/format.js';
import { useCouncil } from './council-context.js';
import { playSound } from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';

const ChatsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 2.5 H14 V9 H7 L4 11.5 V9 H2 Z" />
    <path d="M4.5 5 H11.5 M4.5 6.8 H9" />
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
  const titling = useTitlingJob(() => getCouncilLabels().then(setLabels), ['COUNCIL', 'COUNCILS']);
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
  const runAutotitle = ({ councilIds, force = false } = {}) => {
    if (titling.running) return;
    uiSound('activate');
    setNote('');
    titling.start({ kind: 'councils', councilIds, force });
  };

  const startRename = (id) => { uiSound('open'); setNote(''); setRenaming(id); setDraft(labels[id] || ''); };
  const cancelRename = () => { uiSound('close'); setRenaming(null); };
  const saveRename = async (id) => {
    // A rename mid-batch would race the batch's write for the same council —
    // last-writer-wins on the atomic file, so hold renames until it lands.
    if (titling.running) { setNote('NAMING IN PROGRESS — HOLD THE RENAME'); return; }
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
          disabled={titling.running} title="Name councils from what was deliberated"
        >
          {titling.running ? 'NAMING…' : 'TITLE'}
        </button>
        <button type="button" className="chats-refresh" onClick={() => { uiSound('tick'); council.listCouncils(); }} aria-label="Refresh councils">
          <RefreshGlyph />
        </button>
      </div>
      <TitlingProgress titling={titling} label="Naming councils" />

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

      {note || titling.note ? <div className="chats-note label-data" role="status">{note || titling.note}</div> : null}

      {menu ? createPortal(
        <div
          className="chats-ctx"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 230) }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.batch ? (
            <ChatBatchItems itemClass="chats-ctx-item" titling={titling.running} onRun={(opts) => { runAutotitle(opts); setMenu(null); }} />
          ) : (
            <>
              <button type="button" className="chats-ctx-item" onClick={() => { onReopen(menu.id); setMenu(null); }}>REOPEN</button>
              <button type="button" className="chats-ctx-item" disabled={titling.running} onClick={() => { startRename(menu.id); setMenu(null); }}>RENAME</button>
              <button type="button" className="chats-ctx-item" disabled={titling.running} onClick={() => { runAutotitle({ councilIds: [menu.id], force: true }); setMenu(null); }}>AUTO-TITLE</button>
              <ChatBatchItems itemClass="chats-ctx-item" separatorClass="chats-ctx-sep" titling={titling.running} onRun={(opts) => { runAutotitle(opts); setMenu(null); }} />
            </>
          )}
        </div>,
        document.body
      ) : null}
    </>
  );
};

const ChatsBody = () => {
  const { dispatch } = useWindows();
  const council = useCouncil();
  // Which register of the history is showing: 'ones' | 'councils'.
  const [tab, setTab] = useState('ones');
  const openStream = () => dispatch({ type: 'OPEN', id: 'chat' });
  return (
    <div className="chats">
      {/* Two registers of one history — private threads and the rooms. */}
      <DeskTabs items={[{ id: 'ones', label: 'ONE-ON-ONES' }, { id: 'councils', label: 'COUNCILS' }]}
        value={tab} onChange={next => { uiSound('tick'); setTab(next); }} label="Chat registers"
        className="chats-tabs" tabClassName="chats-tab label-data" panelClassName="chats-panel">
        {tab === 'councils'
          ? <CouncilsRegister council={council} openStream={openStream} />
          : <ChatsOnes council={council} openStream={openStream} />}
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
