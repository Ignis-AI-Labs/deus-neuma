// UpdateBar — the desk's slim update bar and its WHAT'S NEW panel.
//
// Main decides what is on offer (electron/update-bar.cjs); this only draws it. ONE primary act:
// RESTART TO UPDATE when the update is downloaded, DOWNLOAD when this install is a system
// package that cannot install itself. WHAT'S NEW opens the notes; LATER sets this version aside
// until the next launch or a newer version. Nothing restarts without the press, so a turn that
// is running is never cut by an update. The first launch on a new version opens WHAT'S NEW once.

import { useEffect, useState } from 'react';
import { Markdown } from './Markdown.jsx';
import { useUpdateBar } from './use-update-bar.js';
import './UpdateBar.css';

const RestartGlyph = () => (
  <svg className="update-bar-glyph" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M12.2 1.8v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const DownloadGlyph = () => (
  <svg className="update-bar-glyph" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M3 13.5h10" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

// What each act is called and says it will do — the label carries the step, the title the effect.
const PRIMARY = Object.freeze({
  restart: { lead: 'IS READY', label: 'RESTART TO UPDATE', busy: 'RESTARTING…', Glyph: RestartGlyph, does: 'Closes Deus Neuma, installs the update and opens it again' },
  download: { lead: 'IS OUT', label: 'DOWNLOAD', busy: 'OPENING…', Glyph: DownloadGlyph, does: 'Opens the downloads page in your browser; your package manager installs it' },
});

/** The primary act as a button — the same one in the bar and in the panel. */
const PrimaryAct = ({ bar, pending, onAct }) => {
  const p = PRIMARY[bar.action];
  return (
    <button type="button" className="btn btn-sm btn-primary update-bar-primary" title={p.does} disabled={pending === bar.action} onClick={() => onAct(bar.action)}>
      <p.Glyph />
      <span>{pending === bar.action ? p.busy : p.label}</span>
    </button>
  );
};

/**
 * The bar itself. Pure render.
 * @param {{ bar: { version: string, action: 'restart'|'download' }, pending: ?string, refused: ?string,
 *   onAct: (action: string) => void, onNotes: () => void }} props
 */
export const UpdateBarView = ({ bar, pending, refused, onAct, onNotes }) => (
  <div className="cham update-bar" role="status" aria-label={`Deus Neuma ${bar.version} ${PRIMARY[bar.action].lead.toLowerCase()}`}>
    <span className="update-bar-lead">
      <span className="update-bar-version">{bar.version}</span> {PRIMARY[bar.action].lead}
    </span>
    <PrimaryAct bar={bar} pending={pending} onAct={onAct} />
    <button type="button" className="btn btn-sm btn-secondary" onClick={onNotes}>WHAT&apos;S NEW</button>
    <button type="button" className="update-bar-later" disabled={pending === 'later'} onClick={() => onAct('later')}>later</button>
    {refused ? <span className="update-bar-refused">{refused}</span> : null}
  </div>
);

/**
 * The notes, in a plain panel. `bar` (optional) puts the primary act beside CLOSE. Pure render.
 * @param {{ title: string, version: string, notes: { version: string, body: string }[], bar?: object,
 *   pending?: ?string, onAct?: (action: string) => void, onClose: () => void }} props
 */
export const WhatsNewPanel = ({ title, version, notes, bar = null, pending = null, onAct, onClose }) => (
  <div className="update-notes-veil" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="cham update-notes" role="dialog" aria-modal="true" aria-label={title}>
      <div className="cham-in update-notes-in">
        <header className="update-notes-title">{title}</header>
        <div className="update-notes-body">
          {notes.length === 0 ? (
            <p className="update-notes-none">No release notes were published for {version}.</p>
          ) : notes.map((n) => (
            <article key={n.version} className="update-notes-section">
              {notes.length > 1 ? <h3 className="update-notes-version">NEW IN {n.version}</h3> : null}
              <Markdown text={n.body} />
            </article>
          ))}
        </div>
        <footer className="update-notes-actions">
          {bar ? <PrimaryAct bar={bar} pending={pending} onAct={onAct} /> : null}
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>CLOSE</button>
        </footer>
      </div>
    </section>
  </div>
);

// impure — Escape closes whichever panel is open
const useEscape = (open, onClose) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
};

/** The desk's mount: the bar when an update is on offer, WHAT'S NEW when it is opened or due. */
export const UpdateBar = () => {
  const { view, pending, refused, act } = useUpdateBar();
  const [notesOpen, setNotesOpen] = useState(false);
  const bar = view?.bar ?? null;
  const launch = view?.whatsNew ?? null;
  const closeNotes = () => setNotesOpen(false);
  const closeLaunch = () => act('seen');
  useEscape(notesOpen || Boolean(launch), notesOpen ? closeNotes : closeLaunch);

  return (
    <>
      {bar ? <UpdateBarView bar={bar} pending={pending} refused={refused} onAct={act} onNotes={() => setNotesOpen(true)} /> : null}
      {bar && notesOpen ? (
        <WhatsNewPanel title={`WHAT'S NEW IN ${bar.version}`} version={bar.version} notes={bar.notes} bar={bar} pending={pending} onAct={act} onClose={closeNotes} />
      ) : null}
      {launch && !notesOpen ? (
        <WhatsNewPanel title={`NOW RUNNING ${launch.version} · WHAT'S NEW`} version={launch.version} notes={launch.notes} onClose={closeLaunch} />
      ) : null}
    </>
  );
};
