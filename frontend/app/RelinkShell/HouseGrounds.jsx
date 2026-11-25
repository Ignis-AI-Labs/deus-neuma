// HouseGrounds — the HOUSE window's GROUNDS space: where the house works.
// THE GROUND (the house's shared workspace) and the ALLIANCES ROOT (where
// cross-house grounds stand, outside it). Moved whole from HouseApp.jsx
// (the house dossier, 2026-10-17); behaviour unchanged.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettled } from './use-settled.js';
import { getHouseWorkspace, setHouseWorkspace } from '../../services/house-workspace.js';
import { getAllianceGrounds, setAllianceRoot } from '../../services/alliance-ground.js';
import { uiSound } from '../../services/ui-sound.js';
import { ChooseFolder } from './picker/ChooseFolder.jsx';

// THE GROUND — the house's shared workspace, set once by the operator. All
// the house's repositories live under <root>/repos, and councils may work
// there from the floor. Setting it is the standing grant.
export const HouseGround = () => {
  const [ground, setGround] = useState(null); // null = loading
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  const read = (settled = () => false) => getHouseWorkspace().then((g) => { if (!settled()) setGround(g); });
  useSettled((settled) => { read(settled); }, []);

  const saveRoot = async (root) => {
    uiSound('activate');
    setNote('');
    try {
      setGround(await setHouseWorkspace(root));
      setEditing(false);
    } catch (e) { setNote(e.message); }
  };

  const startEdit = () => {
    uiSound('open');
    setDraft(ground?.root || '');
    setEditing(true);
  };

  if (ground === null) return null;
  // A read that failed is not "no ground set": no SET form over a ground that may stand.
  if (ground.unread) {
    return (
      <section className="house-ground">
        <p className="house-ground-head label-data">HOUSE WORKSPACE</p>
        <p className="house-ground-note label-data" role="alert">{`COULD NOT READ THE GROUND — ${ground.unread}`}</p>
        <button type="button" className="house-ground-go label-data" onClick={() => { uiSound('open'); setGround(null); read(); }}>
          RETRY
        </button>
      </section>
    );
  }
  return (
    <section className="house-ground">
      <p className="house-ground-head label-data">
        HOUSE WORKSPACE
        {ground.root && !editing ? (
          <button type="button" className="house-ground-move label-data" onClick={startEdit}>MOVE</button>
        ) : null}
      </p>
      {editing || !ground.root ? (
        <div className="house-ground-set">
          {/* BROWSE is the door — the system's own folder dialog, the same
              one OPEN FOLDER uses. The typed path stays as the power fallback. */}
          <button type="button" className="house-ground-go label-data" onClick={() => { uiSound('open'); setPicking(true); }}>
            BROWSE…
          </button>
          <input
            className="house-ground-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveRoot(draft.trim()); if (e.key === 'Escape') setEditing(false); }}
            placeholder="/absolute/path/to/the/house/workspace"
            spellCheck={false}
          />
          <button type="button" className="house-ground-go label-data" onClick={() => saveRoot(draft.trim())} disabled={!draft.trim()}>
            SET THE GROUND
          </button>
        </div>
      ) : (
        <p className="house-ground-path label-data" title="The shared ground — councils may work here; repos live under repos/">
          {ground.root}
          <span className="house-ground-repos">
            {' '}· {ground.repos.length === 0 ? 'NO REPOS YET' : `${ground.repos.length} REPO${ground.repos.length === 1 ? '' : 'S'}: ${ground.repos.join(' · ').toUpperCase()}`}
          </span>
        </p>
      )}
      {!ground.root && !editing ? (
        <p className="house-ground-why label-data">THE SHARED GROUND EVERY COUNCIL AND TEAM WORKS ON — SET IT ONCE; REPOS LIVE INSIDE IT</p>
      ) : null}
      {note ? <p className="house-ground-note label-data">{note}</p> : null}
      {picking ? createPortal(
        <ChooseFolder
          initialPath={ground?.root || undefined}
          onPick={(abs) => { setPicking(false); setDraft(abs); saveRoot(abs); }}
          onCancel={() => setPicking(false)}
        />,
        document.body,
      ) : null}
    </section>
  );
};

// THE ALLIANCES ROOT — where CROSS-HOUSE grounds stand. A sealed witness or a
// neuma of another house works in a folder named from both houses, and that
// folder lives OUTSIDE the house ground: an external party must never be
// standing in your house to work with you (Design note, 2026-07-26. The server refuses
// a root inside the house ground in either direction. Nothing is created until
// the operator raises a specific ground, from the room.
export const AllianceGround = () => {
  const [state, setState] = useState(null); // null = loading
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  useSettled((settled) => {
    getAllianceGrounds().then((g) => { if (!settled()) setState(g); });
  }, []);

  const saveRoot = async (root) => {
    uiSound('activate');
    setNote('');
    try {
      setState(await setAllianceRoot(root));
      setEditing(false);
    } catch (e) { setNote(e.message); }
  };

  const startEdit = () => {
    uiSound('open');
    // The suggestion is PRE-FILL, never an act: a sibling of the house ground,
    // offered so the operator has somewhere sane to say yes to.
    setDraft(state?.root || state?.suggestion || '');
    setEditing(true);
  };

  if (state === null) return null;
  return (
    <section className="house-ground">
      <p className="house-ground-head label-data">
        CROSS-HOUSE GROUNDS
        {state.root && !editing ? (
          <button type="button" className="house-ground-move label-data" onClick={startEdit}>MOVE</button>
        ) : null}
      </p>
      {editing || !state.root ? (
        <div className="house-ground-set">
          <button type="button" className="house-ground-go label-data" onClick={() => { uiSound('open'); setPicking(true); }}>
            BROWSE…
          </button>
          <input
            className="house-ground-input"
            value={editing ? draft : (state.suggestion || '')}
            onChange={(e) => { setDraft(e.target.value); setEditing(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter') saveRoot(draft.trim()); if (e.key === 'Escape') setEditing(false); }}
            placeholder="/absolute/path/outside/your/house"
            spellCheck={false}
          />
          <button
            type="button"
            className="house-ground-go label-data"
            onClick={() => saveRoot((editing ? draft : (state.suggestion || '')).trim())}
            disabled={!(editing ? draft : (state.suggestion || '')).trim()}
          >
            SET THE ALLIANCES ROOT
          </button>
        </div>
      ) : (
        <p className="house-ground-path label-data" title="Where grounds shared with other houses stand — one folder per pairing, named from both house names">
          {state.root}
          <span className="house-ground-repos">
            {' '}· {state.alliances.length === 0
              ? 'NONE RAISED YET'
              : state.alliances.map((a) => a.name.toUpperCase()).join(' · ')}
          </span>
        </p>
      )}
      {!state.root && !editing ? (
        <p className="house-ground-why label-data">
          WHERE YOU MEET OTHER HOUSES — OUTSIDE YOUR OWN GROUND, ONE FOLDER PER PAIRING; NOTHING IS CREATED UNTIL YOU RAISE IT
        </p>
      ) : null}
      {note ? <p className="house-ground-note label-data">{note}</p> : null}
      {picking ? createPortal(
        <ChooseFolder
          initialPath={state?.root || state?.suggestion || undefined}
          onPick={(abs) => { setPicking(false); setDraft(abs); saveRoot(abs); }}
          onCancel={() => setPicking(false)}
        />,
        document.body,
      ) : null}
    </section>
  );
};
