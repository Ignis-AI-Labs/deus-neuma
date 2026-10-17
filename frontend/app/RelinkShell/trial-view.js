// trial-view.js — pure presentation decisions for the BRICKWORKS trial panel.
// Pure — no fetch, no DOM; unit-tested directly.

// The scorecard checks in display order, with honest labels: a static check
// says the surface is PRESENT, not that play was proven.
export const CHECK_LABELS = Object.freeze([
  Object.freeze(['completed', 'ALL ROLES REPORTED']),
  Object.freeze(['artifact', 'FINAL GAME SHIPPED']),
  Object.freeze(['canvas', 'PLAY SURFACE']),
  Object.freeze(['bench', 'PROBE SURFACE']),
  Object.freeze(['rafLoop', 'GAME LOOP']),
  Object.freeze(['input', 'CONTROLS']),
  Object.freeze(['syntaxValid', 'CODE COMPILES']),
  Object.freeze(['selfContained', 'SELF-CONTAINED']),
]);

// pure — the visual weight a verdict carries.
export const verdictTone = (verdict) =>
  verdict === 'PASS' ? 'ok' : verdict === 'PARTIAL' ? 'warn' : 'bad';

// pure — wall-clock for humans: 61234 → "1m 1s", 900 → "0.9s".
export const fmtMs = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

// pure — one line for the history list: date · model · score · verdict.
export const trialSummaryLine = (card) => {
  const day = String(card?.runAt || '').slice(0, 10) || '—';
  const model = card?.substrate?.model || 'unknown substrate';
  const pts = card?.score ? `${card.score.points}/${card.score.max}` : '—';
  const verdict = card?.score?.verdict || '—';
  return `${day} · ${model} · ${pts} ${verdict}`;
};

// pure — the trial's five seats in assignment order (mirrors the backend's
// TRIAL_POSITIONS; position 5 is the LEAD, who directs refinement waves).
export const TRIAL_SEATS = Object.freeze(['HELM', 'WRIGHT', 'SMITH', 'WARDEN', 'LEAD']);

// pure — the default seat picks for a fresh roster: round-robin across the
// roster in order (mirrors buildTrialPlan's assignment rule, so the default
// never lies about the plan the backend will run).
export const defaultSeatPicks = (roster) => {
  const ids = roster.map((m) => m.neumaId).filter(Boolean);
  if (!ids.length) return TRIAL_SEATS.map(() => '');
  return TRIAL_SEATS.map((_, i) => ids[i % ids.length]);
};
