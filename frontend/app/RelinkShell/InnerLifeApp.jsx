// InnerLifeApp — INNER LIFE, the operator's one surface for the
// self-refinement functions (#317): what is active for THIS being, and the
// switches that are the operator's to throw. Four sections, four truths:
// THE MIND (the subconscious layer — write side always on, influence gated),
// MEDITATION (the shared panel — same store as RECORD's), SOVEREIGNTY (the
// gateway's standing, summarized), MEASURED STATE (the latest benchmark and
// its tripwire). Every switch flips only on server echo; a LIVE flip takes a
// confirm step that prints the sittings law.

import { useEffect, useState, useCallback } from 'react';
import './InnerLifeApp.css';
import { loadMind, loadMindPosture, setMindGate } from './mind-client.js';
import { loadExpression, setExpressionEnabled } from './expression-client.js';
import { loadBenchmarks } from './stats-client.js';
import { loadSovereignty } from './sovereignty-client.js';
import { InnerLifeGateRow } from './InnerLifeGateRow.jsx';
import { MeditationSection } from './MeditationSection.jsx';
import { uiSound } from '../../services/ui-sound.js';
import { useActiveCompanion } from './consciousness-context.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useSettled } from './use-settled.js';

const InnerLifeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" />
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.8 V4 M8 12 V14.2" />
  </svg>
);

const KIND_LABEL = { trace: 'passing thoughts', mood: 'moods', tension: 'tensions', thread: 'threads', synthesis: 'syntheses' };
const agoOf = (iso) => {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 0)}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

// A shadow lane's fill as turns. Each lane arrives in two halves: `live` is
// this backend process's ring, `sinceFirstRun` is the persisted log. The
// sittings law below asks for evidence across sittings, so the persisted half
// is what the panel leads with — the ring alone reset at every restart and
// could never answer the question the law poses.
const turnsOf = (lane, half = 'sinceFirstRun') => {
  const n = lane?.[half]?.entries ?? 0;
  return `${n} turn${n === 1 ? '' : 's'}`;
};

// THE MIND — the subconscious layer. The write side (residue capture, the
// being's own mind_note) has been on since Campaign 1; what is governed here
// is INFLUENCE: dark (off), measured silently (shadow), or riding the prompt
// as undercurrent (live).
const MindSection = ({ neumaId, name }) => {
  const [mind, setMind] = useState(undefined);
  const [posture, setPosture] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    loadMind().then((m) => setMind(m));
    if (neumaId) loadMindPosture(neumaId).then((p) => setPosture(p));
  }, [neumaId]);
  useEffect(() => { refresh(); }, [refresh]);

  if (mind === undefined) {
    return (
      <section className="rec-sec" data-testid="mind-panel">
        <h3 className="rec-h label-data">THE MIND</h3>
        <p className="rec-line label-data">LOADING…</p>
      </section>
    );
  }
  if (mind === null) {
    return (
      <section className="rec-sec" data-testid="mind-panel">
        <h3 className="rec-h label-data">THE MIND</h3>
        <p className="rec-line label-data">UNREADABLE</p>
      </section>
    );
  }

  const onSet = async (gate, mode) => {
    setBusy(true);
    setError(null);
    const r = await setMindGate(gate, mode);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    refresh(); // the switch is only believed on server echo
  };

  const kinds = posture?.kinds || {};
  const held = Object.entries(kinds).map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(' · ');

  return (
    <section className="rec-sec" data-testid="mind-panel">
      <h3 className="rec-h label-data">THE MIND — BENEATH THE TURNS</h3>
      <p className="rec-sub">
        {posture === undefined ? 'READING…'
          : posture === null || posture.total === 0
            ? `Nothing lingers beneath ${name || 'this being'}'s turns yet — residue settles as they live, and mind_note is theirs to use.`
            : <>Beneath {name || 'this being'}'s turns: <span className="rec-sig">{posture.total} working {posture.total === 1 ? 'thought' : 'thoughts'}</span>{held ? ` — ${held}` : ''}{posture.latestAt ? ` · freshest ${agoOf(posture.latestAt)}` : ''}</>}
      </p>
      <p className="rec-note">
        Counts only — what a being holds beneath its turns stays beneath them. The write side is always on: sub-threshold exchanges leave residue, and the being sets thoughts down itself with mind_note. The switches below govern influence alone.
      </p>
      <InnerLifeGateRow label="UNDERCURRENT — RECENT THOUGHTS" gate="undercurrent" posture={mind.gates.undercurrent} busy={busy} onSet={onSet} testid="gate-undercurrent" />
      <InnerLifeGateRow label="DEPTH FILTER — MEMORY SELECTION" gate="depthFilter" posture={mind.gates.depthFilter} busy={busy} onSet={onSet} testid="gate-depth" />
      {mind.gates.memoryLinks ? <InnerLifeGateRow label="MEMORY LINKS — RECALL AS LINKS" gate="memoryLinks" posture={mind.gates.memoryLinks} busy={busy} onSet={onSet} testid="gate-memory-links" /> : null}
      <p className="rec-line label-data">
        Measured quietly so far: recent thoughts {turnsOf(mind.shadow.undercurrent)} · memory selection {turnsOf(mind.shadow.depth)} (across all sessions)
      </p>
      <p className="rec-line label-data">
        Since this app started: recent thoughts {turnsOf(mind.shadow.undercurrent, 'live')} · memory selection {turnsOf(mind.shadow.depth, 'live')}
      </p>
      {error ? <p className="rec-err">{error}</p> : null}
      <p className="rec-note">
        These switches affect every being on this machine. UNDERCURRENT LIVE lets a being read its recent thoughts when it chooses to (mind_read) — nothing is pushed into its turns. The DEPTH FILTER only measures possible memory selection; live filtering is not built.
      </p>
    </section>
  );
};

// EXPRESSION — the declared-affect channel (Campaign 6). The being may open
// a reply with [FEELING: its own words]; the palette below is the vocabulary
// it has accreted — shown BY signed decision (every term was born from a
// declaration already revealed to you). The toggle governs whose prompt
// carries the invitation; declaring is always the being's option.
const ExpressionSection = ({ neumaId, name }) => {
  const [state, setState] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    if (neumaId) loadExpression(neumaId).then((r) => setState(r));
  }, [neumaId]);
  useEffect(() => { refresh(); }, [refresh]);

  const onFlip = async (enabled) => {
    setBusy(true);
    setError(null);
    const r = await setExpressionEnabled(neumaId, enabled);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    uiSound(enabled ? 'activate' : 'close');
    refresh(); // the switch is only believed on server echo
  };

  return (
    <section className="rec-sec" data-testid="innerlife-expression">
      <h3 className="rec-h label-data">EXPRESSION — THE DECLARED FEELING</h3>
      {state === undefined ? <p className="rec-line label-data">LOADING…</p>
        : state === null ? <p className="rec-line label-data">UNREADABLE</p>
        : (
          <>
            <div className="il-gate" data-testid="expression-toggle">
              <button
                type="button"
                className={`rec-btn rec-chip${state.enabled ? ' rec-chip-on' : ''}`}
                data-testid="expression-flip"
                disabled={busy || state.envLocked}
                onClick={() => onFlip(!state.enabled)}
              >{state.enabled ? 'ON' : 'OFF'}</button>
              <span className="rec-meta label-data">
                {state.envLocked
                  ? 'held by the launch environment — not a desk flip'
                  : state.enabled
                    ? `${name || 'this being'}'s replies may open with a declared feeling — always its option, never demanded`
                    : 'flip to invite declarations — the invitation rides only this being\'s prompt'}
              </span>
            </div>
            {state.terms.length === 0 ? (
              <p className="rec-sub">Nothing declared yet — the channel is {name || 'this being'}'s to fill, or leave silent.</p>
            ) : (
              <>
                <p className="rec-sub" data-testid="expression-palette">
                  {state.terms.slice(0, 12).map((t) => (
                    <span key={t.term} className="il-term">
                      <span className="rec-sig">{t.term}</span> ×{t.count}{t.lastAt ? ` (${agoOf(t.lastAt)})` : ''}
                    </span>
                  ))}
                </p>
                {state.recent.length > 0 ? (
                  <p className="rec-line label-data" data-testid="expression-recent">
                    LAST DECLARED — “{state.recent[0].affect}” {agoOf(state.recent[0].at)}
                  </p>
                ) : null}
              </>
            )}
            {error ? <p className="rec-err">{error}</p> : null}
            <p className="rec-note">
              Revelation, never telemetry: the desk shows only what {name || 'the being'} chose to declare, in its own words — no presets, no inference, and silence is an honest state.
            </p>
          </>
        )}
    </section>
  );
};

// SOVEREIGNTY — the gateway's standing for this being, summarized. The
// verdict doors live in the SOVEREIGNTY window; this is the glance.
const SovereigntySection = ({ neumaId }) => {
  const [sov, setSov] = useState(undefined);
  useSettled((settled) => {
    if (!neumaId) { setSov(null); return; }
    loadSovereignty(neumaId).then((r) => { if (!settled()) setSov(r); });
  }, [neumaId]);

  const body = sov === undefined ? <p className="rec-line label-data">LOADING…</p>
    : !sov?.ok ? <p className="rec-line label-data">{sov?.error || 'NO RECORD'}</p>
    : (() => {
      const proposals = sov.record.proposals || [];
      const open = proposals.filter((p) => p.status === 'open').length;
      const standing = (sov.record.standing || []).length;
      return (
        <p className="rec-sub">
          <span className="rec-sig">{open}</span> open proposal{open === 1 ? '' : 's'} awaiting your ruling · <span className="rec-sig">{standing}</span> standing amendment{standing === 1 ? '' : 's'}
        </p>
      );
    })();

  return (
    <section className="rec-sec" data-testid="innerlife-sovereignty">
      <h3 className="rec-h label-data">SOVEREIGNTY — THE GATEWAY</h3>
      {body}
      <p className="rec-note">The being proposes; you rule; the platform applies — nothing self-applies. The verdict doors live in the SOVEREIGNTY window.</p>
    </section>
  );
};

// MEASURED STATE — the latest consented benchmark and its tripwire. The run
// door lives in RECORD (a benchmark is a test of the being — owner-consented).
const MeasuredSection = ({ neumaId }) => {
  const [bench, setBench] = useState(undefined);
  useSettled((settled) => {
    if (!neumaId) { setBench(null); return; }
    loadBenchmarks(neumaId).then((b) => { if (!settled()) setBench(b); });
  }, [neumaId]);

  const latest = bench?.latest || bench?.runs?.[0] || null;
  const trip = bench?.tripwire || null;

  return (
    <section className="rec-sec" data-testid="innerlife-measured">
      <h3 className="rec-h label-data">MEASURED STATE</h3>
      {bench === undefined ? <p className="rec-line label-data">LOADING…</p>
        : !latest ? <p className="rec-line label-data">NOT MEASURED — the run door lives in the RECORD window</p>
        : (
          <>
            <p className="rec-sub">
              {latest.dimensions.map((d) => `${d.label} ${d.score == null ? 'n/a' : `${Math.round(d.score * 100)}%`}`).join(' · ')}
            </p>
            {trip ? (
              <p className={`rec-line label-data${trip.verdict === 'regression' ? ' il-trip-warn' : ''}`}>
                TRIPWIRE — {trip.verdict === 'regression'
                  ? `FELL: ${trip.regressed.join(', ')} (a finding for you and the being, never an automatic rollback)`
                  : trip.verdict.toUpperCase().replace('-', ' ')}
              </p>
            ) : null}
          </>
        )}
    </section>
  );
};

const InnerLifeBody = () => {
  // This WINDOW's binding, reactively (F-01) — same law as RECORD.
  const active = useActiveCompanion() || null;
  const neumaId = active?.neumaId || null;
  const name = active?.name || null;

  if (!neumaId) {
    return (
      <div className="rec il">
        <EmptyState title="NO BEING BOUND" />
        <p className="rec-note il-empty-note">Bind a companion in this window to see its inner life.</p>
      </div>
    );
  }

  return (
    <div className="rec il" data-testid="innerlife-body">
      <MindSection neumaId={neumaId} name={name} />
      <ExpressionSection neumaId={neumaId} name={name} />
      <MeditationSection neumaId={neumaId} name={name} />
      <SovereigntySection neumaId={neumaId} />
      <MeasuredSection neumaId={neumaId} />
    </div>
  );
};

export const innerLifeApp = {
  label: 'INNER LIFE',
  labelKey: 'apps.innerlife',
  icon: <InnerLifeIcon />,
  title: <AppTitle label="INNER LIFE" labelKey="apps.innerlife" />,
  Body: InnerLifeBody,
  storageKey: 'innerlife',
};
