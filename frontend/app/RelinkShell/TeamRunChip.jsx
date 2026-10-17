// TeamRunChip — a LEAD being's team, working live inside the stream.
//
// Renders a teamrun segment from the stream-reducer: the approved plan's
// steps with each member's live state (waiting / working / done / failed)
// fed by the portal's board events, exactly the objective states the TEAMS
// composer shows. Never a gate — the operator already ruled on the plan —
// but a background run carries the operator's STOP (the run, or one working
// member). Settles to the run's outcome.
//
// A finished run carries its DELIVERY (Founder's delivery law, 2026-07-15): the
// witness opens every deliverable FROM HERE — browse the workspace, view an
// image, RUN an .html, read the code — no folder-hunting. The list walks the
// workspace live on open, so the LEAD's writes after team_run (assembly, QA
// fixes, the executed proof) are all present. Model-written HTML/SVG only
// ever runs inside <iframe sandbox=[…]> via srcDoc — rendered
// with NO same-origin access, the BRICKWORKS containment.

import { useState } from 'react';
import { readRun, readRunDelivery, readRunDeliveryFile } from './team-client.js';
import { openFolder } from '../../services/user-files.js';
import { useWindows } from '../windowing/use-windows.js';
import { playSound } from '../../services/sound-engine.js';
import { formatBytes } from '../../utils/format.js';
import { StopRunButton, StopMemberButton } from './TeamRunControls.jsx';
import { useTeamRunPhase } from './team-runs-context.js';
import '../../components/ToolActionChip/ToolActionChip.css';

const STATE_GLYPHS = Object.freeze({
  done: '■',
  working: '▸',
  waiting: '□',
  failed: '×',
});

const SETTLED_LABELS = Object.freeze({
  done: 'TEAM FINISHED',
  error: 'RUN FAILED',
  stopped: 'RUN STOPPED',
  lost: 'RUN INTERRUPTED — PICK IT UP IN THE WORKFLOW',
  expired: 'RUN STATE LOST — SEE THE REPLY',
});

const IMAGE_MIME = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
});

const imageMime = (file) => IMAGE_MIME[String(file).slice(String(file).lastIndexOf('.')).toLowerCase()] || 'image/png';

// The one file the witness opened, rendered by its kind.
const DeliverableView = ({ view }) => {
  if (view.kind === 'image') {
    return <img className="delivery-image" alt={view.file} src={`data:${imageMime(view.file)};base64,${view.base64}`} />;
  }
  if (view.kind === 'html' || view.kind === 'svg') {
    return (
      <iframe
        className="delivery-frame"
        title={`DELIVERY — ${view.file}`}
        sandbox="allow-scripts"
        srcDoc={view.text}
      />
    );
  }
  return <pre className="delivery-text">{view.text}</pre>;
};

// The finished run's delivery — closed by default; opening walks the
// workspace live. Exported: the WORKFLOW window offers the same desk.
export const DeliveryDesk = ({ delivery }) => {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState(null); // { files, truncated } | null while loading
  const [err, setErr] = useState(null);
  const [view, setView] = useState(null); // the opened file's data
  const [opening, setOpening] = useState(null); // file being fetched
  const { dispatch } = useWindows();

  // The full workspace in the FILES app, one click: register the arena as a
  // root, tell a mounted FILES to focus it, and bring the window forward.
  const openInFiles = async () => {
    playSound('confirm');
    try {
      await openFolder(delivery.root);
      window.dispatchEvent(new CustomEvent('neuma:files-focus-root', { detail: { root: delivery.root } }));
      dispatch({ type: 'OPEN', id: 'files' });
    } catch (e) {
      setErr(String(e.message || 'FILES COULD NOT OPEN THE FOLDER').toUpperCase());
    }
  };

  const toggle = async () => {
    playSound('menuOpen');
    if (open) { setOpen(false); return; }
    setOpen(true);
    setErr(null);
    const { ok, delivery: d } = await readRunDelivery(delivery.id);
    if (!ok || !d) { setErr('THE DELIVERY COULD NOT BE READ — THE PLATFORM DID NOT ANSWER.'); setListing({ files: [] }); return; }
    setListing(d);
  };

  const openFile = async (file) => {
    if (opening) return;
    playSound('confirm');
    // The same file closes on a second click — a reader's toggle.
    if (view?.file === file) { setView(null); return; }
    setOpening(file);
    setErr(null);
    const res = await readRunDeliveryFile(delivery.id, file);
    setOpening(null);
    if (!res.ok) { setErr(String(res.error).toUpperCase()); return; }
    setView(res);
  };

  return (
    <div className="delivery">
      <button type="button" className="delivery-toggle label-data" onClick={toggle}>
        {open ? 'CLOSE THE DELIVERY' : 'OPEN THE DELIVERY'}
      </button>
      {open ? (
        <div className="delivery-body">
          <div className="delivery-rootline">
            <span className="delivery-root label-data">{delivery.root}</span>
            <button type="button" className="delivery-open label-data" onClick={openInFiles}>
              OPEN IN FILES
            </button>
          </div>
          {err ? <p className="delivery-err label-data">{err}</p> : null}
          {!listing ? <p className="delivery-hint label-data">READING…</p>
            : listing.files.length === 0 ? <p className="delivery-hint label-data">THE WORKSPACE IS EMPTY.</p>
            : (
              <ul className="delivery-files">
                {listing.files.map((f) => (
                  <li key={f.file} className="delivery-file">
                    <span className="delivery-file-name">{f.file}</span>
                    <span className="delivery-file-bytes label-data">{Number.isFinite(f.bytes) ? formatBytes(f.bytes) : '—'}</span>
                    <button
                      type="button"
                      className={`delivery-open label-data${view?.file === f.file ? ' is-on' : ''}`}
                      disabled={Boolean(opening)}
                      onClick={() => openFile(f.file)}
                    >
                      {opening === f.file ? 'OPENING…'
                        : view?.file === f.file ? 'CLOSE'
                        : f.kind === 'html' ? 'RUN'
                        : 'VIEW'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          {listing?.truncated ? <p className="delivery-hint label-data">MORE FILES THAN THE STREAM SHOWS — OPEN THE FOLDER IN FILES.</p> : null}
          {view ? <DeliverableView view={view} /> : null}
        </div>
      ) : null}
    </div>
  );
};

// The run's WORK HISTORY — how the team actually got the job done: each
// member's part in completion order, its status check-in, its torch. Read
// from the persisted run record (the witness's record; the being's inner
// account lives in its own encrypted journal, never here). Exported: the
// WORKFLOW window opens the same record.
export const WorkHistory = ({ record }) => {
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState(null);
  const [err, setErr] = useState(null);

  const toggle = async () => {
    playSound('menuOpen');
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (run) return;
    const res = await readRun(record);
    if (!res.ok || !res.run) { setErr('THE RUN RECORD COULD NOT BE READ — THE PLATFORM DID NOT ANSWER.'); return; }
    setRun(res.run);
  };

  const stepById = (id) => (run?.steps || []).find((s) => s.id === id) || {};
  const memberName = (neumaId) => run?.names?.[neumaId] || neumaId;
  const order = run?.order?.length ? run.order : Object.keys(run?.completed || {});

  return (
    <div className="delivery">
      <button type="button" className="delivery-toggle label-data" onClick={toggle}>
        {open ? 'CLOSE THE WORK HISTORY' : 'HOW THEY WORKED'}
      </button>
      {open ? (
        <div className="delivery-body">
          {err ? <p className="delivery-err label-data">{err}</p> : null}
          {!run && !err ? <p className="delivery-hint label-data">READING…</p> : null}
          {run ? (
            <ol className="history-steps">
              {order.map((stepId) => {
                const step = stepById(stepId);
                return (
                  <li key={stepId} className="history-step">
                    <div className="history-step-head label-data">
                      <span className="history-step-id">{stepId}</span>
                      <span className="history-step-member">{memberName(step.neumaId)}</span>
                      {step.role ? <span className="history-step-role">{step.role}</span> : null}
                    </div>
                    {run.statuses?.[stepId] ? (
                      <p className="history-step-status label-data">STATUS: {run.statuses[stepId]}</p>
                    ) : null}
                    <pre className="delivery-text">{run.completed?.[stepId] || '(no delivery recorded for this part)'}</pre>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const TeamRunChip = ({ segment }) => {
  const { id, name, goal, board, detail, delivery, background } = segment;
  // The desk's run store outlives this chat's frames: a chip still pending
  // for a run the desk knows has settled (its end arrived while this chat was
  // not listening, or its backend restarted) reads the run as it stands.
  const desk = useTeamRunPhase(id);
  const [deskPhase, deskStatus] = desk ? desk.split('|') : [];
  const settledElsewhere = segment.phase === 'pending' && deskPhase === 'settled' && Boolean(deskStatus);
  const phase = settledElsewhere ? 'resolved' : segment.phase;
  const status = settledElsewhere ? deskStatus : segment.status;
  const record = settledElsewhere ? id : segment.record;
  // The multi-stream door: the run's substream in its own window, so the
  // witness watches the workflow without touching this stream.
  const { dispatch } = useWindows();
  const openWorkflow = () => {
    playSound('menuOpen');
    dispatch({ type: 'OPEN', id: 'workflow' });
  };

  if (phase === 'pending') {
    return (
      <div className="tool-chip teamrun-chip pending">
        <div className="tool-chip-head">
          <span className="tool-chip-tag">TEAM AT WORK</span>
          {name ? <span className="tool-chip-name">{name}</span> : null}
          <button type="button" className="teamrun-chip-workflow label-data" onClick={openWorkflow}>
            OPEN THE WORKFLOW
          </button>
          {/* Only a background run has stop controls: an in-turn run still
              answers to the composer's STOP. */}
          {background ? <StopRunButton runId={id} /> : null}
        </div>
        {goal ? <p className="teamrun-chip-goal">{goal}</p> : null}
        <ul className="teamrun-chip-board">
          {board.map((e) => (
            <li key={e.id} className={`teamrun-chip-row is-${e.state}`}>
              <span className="teamrun-chip-glyph">{STATE_GLYPHS[e.state] || '□'}</span>
              <span className="teamrun-chip-id">{e.id}</span>
              <span className="teamrun-chip-member">{e.member}</span>
              <span className="teamrun-chip-state">{e.state.toUpperCase()}</span>
              {e.status ? <span className="teamrun-chip-status">{e.status}</span> : null}
              {background && e.state === 'working' ? <StopMemberButton runId={id} stepId={e.id} /> : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const ok = status === 'done';
  return (
    <div className={`tool-chip resolved teamrun-chip ${ok ? 'ok' : 'failed'}`}>
      <div className="tool-chip-head">
        <span className="tool-chip-sigil">⟐</span>
        <span className="tool-chip-summary">
          {name ? `${name} — ` : ''}{SETTLED_LABELS[status] || 'SETTLED'}
          {detail ? `: ${detail}` : ''}
        </span>
      </div>
      {/* A failed run keeps its record now — what DID happen stays readable. */}
      {record ? <WorkHistory record={record} /> : null}
      {ok && delivery ? <DeliveryDesk delivery={delivery} /> : null}
    </div>
  );
};
