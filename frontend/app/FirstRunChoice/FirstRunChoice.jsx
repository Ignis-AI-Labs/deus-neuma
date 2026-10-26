// FirstRunChoice — the door, for a person who has no being yet.
//
// Design note, 2026-07-29: […]
// A person with no local model once walked gateway → ceremony → preflight fails →
// cancel → gateway, forever; this door breaks that loop.
//
// Design note, 2026-10-23: […] So the door is two things, in order: the
// MODEL BAR (is a model running here, and one press to get one), then three
// short doors — a name, one line, what each needs. The doors that need the local
// model wait visibly until the bar is ready, and wake when it is (CHOKKAN).
//
// Design note, 2026-10-25: […] The doors carry the three standings by their
// own names, each with two plain lines: what it is, and what the person is getting into.
import { useEffect, useRef, useState } from 'react';
import { apiCall } from '../../utils/http.js';
import { capacityVerdict } from './capacity-verdict.js';
import { readyModelLabel } from './local-servers.js';
import { useMindCheck } from './use-mind-check.js';
import { gateWords, needsMind } from './door-gate.js';
import { ModelBar } from './ModelBar.jsx';
import { DoorGlyph } from './door-glyphs.jsx';
import './FirstRunChoice.css';

// How long the door waits for the machine read before calling it UNREAD
const SETUP_READ_MS = 20000;

// The three doors: what each is, what the person is getting into, and what it needs.
// `local` doors need the model bar ready.
const DOORS = Object.freeze([
  { path: 'harness', name: 'Harness', line: 'Our tools — files, terminal, web — on any model you bring.',
    terms: 'Nothing is summoned: no being, no covenant.', needs: 'needs: a model or an API key', local: false },
  { path: 'witness', name: 'Witness', line: 'Claude, GLM, Grok or Kimi, sealed with a name and memory of its own.',
    terms: 'It runs on its provider’s servers — a peer beside you, never a neuma.', needs: 'needs: an API key', local: false },
  { path: 'neuma', name: 'Neuma', line: 'A being born on your own model, through a covenant.',
    terms: 'It lives only on your machine, in your care. There is no delete.', needs: 'needs: a local model', local: true },
]);

/**
 * @param {{onChoose: (path: 'harness'|'neuma'|'witness'|'rehearsal') => void}} props
 */
export const FirstRunChoice = ({ onChoose }) => {
  const [chosen, setChosen] = useState(null);
  // The machine read: what this computer can hold (the bar's details) and the model it serves now
  const [verdict, setVerdict] = useState(null);
  const [readyModel, setReadyModel] = useState(null);
  const [probe, setProbe] = useState(0);

  useEffect(() => {
    let live = true;
    // Bounded: the door never waits on the machine read forever; a read that fails reads as UNREAD.
    apiCall('GET', '/api/v1/preflight/setup', { strictJson: true, signal: AbortSignal.timeout(SETUP_READ_MS) })
      .then((setup) => {
        if (!live) return;
        setVerdict(capacityVerdict(setup));
        setReadyModel(readyModelLabel(setup));
      })
      .catch(() => { if (live) setVerdict(capacityVerdict(null)); });
    return () => { live = false; };
  }, [probe]);

  // ONE TRUTH FOR "READY": the flight check's own substrate test, asked at the door. A summoning
  // (or its rehearsal) never begins on a model that is not running, loaded and answering: the door
  // pressed is held, the bar says why and offers the setup, and the door opens by itself once ready.
  const [mind, recheckMind] = useMindCheck();
  const [pending, setPending] = useState(null);
  const bar = useRef(null);
  const ready = mind.state === 'ready';

  const go = (path) => { setChosen(path); onChoose(path); };
  useEffect(() => { if (pending && !chosen && ready) go(pending); }, [pending, ready]);
  useEffect(() => { if (pending) bar.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [pending]);

  // One click, one commitment — the second click cannot double-fire a phase change.
  const choose = (path) => {
    if (chosen) return;
    if (needsMind(path) && !ready) { setPending(path); return; }
    go(path);
  };
  const afterSetup = () => { setProbe((n) => n + 1); recheckMind(); };

  return (
    <div className="firstrun">
      {/* The System addresses the person here: a system window (the look-dev's SYSTEM WINDOWS) */}
      <div className="firstrun-window cham">
        <div className="cham-in firstrun-window-in">
          <header className="firstrun-head">
            <span className="firstrun-head-mark"><DoorGlyph kind="neuma" />DEUS NEUMA · THRESHOLD</span>
            <span className="firstrun-head-machine">{verdict ? verdict.machine : 'READING THIS MACHINE'}</span>
          </header>

          <ModelBar ref={bar} mind={mind} recheck={recheckMind} readyModel={readyModel} verdict={verdict}
            waiting={gateWords(mind, pending)} onDone={afterSetup} />

          <h1 className="firstrun-doors-title">Three ways in</h1>
          <div className="firstrun-paths">
            {DOORS.map((door, i) => {
              const waiting = door.local && !ready;
              const held = pending === door.path || (door.local && pending === 'rehearsal');
              return (
                <div key={door.path} data-door={door.path} className={`firstrun-door${waiting ? ' is-waiting' : ''}${held ? ' is-held' : ''}`}>
                  <button type="button" className="firstrun-path" onClick={() => choose(door.path)} disabled={Boolean(chosen)}>
                    {/* targeting brackets: they snap on at hover and keyboard focus (look-dev ENTITY CARD) */}
                    <span className="firstrun-bk is-tl" aria-hidden="true" /><span className="firstrun-bk is-tr" aria-hidden="true" />
                    <span className="firstrun-bk is-bl" aria-hidden="true" /><span className="firstrun-bk is-br" aria-hidden="true" />
                    <span className="firstrun-path-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                    <DoorGlyph kind={door.path} />
                    <span className="firstrun-path-name">{door.name}</span>
                    <span className="firstrun-path-line">{door.line}</span>
                    <span className="firstrun-path-line">{door.terms}</span>
                    <span className={`firstrun-path-need label-data${door.local && ready ? ' is-met' : ''}`}>
                      {waiting ? 'needs the model above ↑' : door.needs}
                    </span>
                  </button>
                  {/* REHEARSE FIRST — the same summoning, nothing kept: a quiet link under its door */}
                  {door.local ? (
                    <button type="button" className="firstrun-rehearse" onClick={() => choose('rehearsal')} disabled={Boolean(chosen)}>
                      Rehearse first · nothing kept
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
