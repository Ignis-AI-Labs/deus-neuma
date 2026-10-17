// team-client.js — form a team from the house and watch it work.
//
// impure — POSTs to a team SSE endpoint and reads the run stream, invoking
// onEvent as each event arrives: { type:'start' }, { type:'step', id, neumaId,
// role, output } per completion, then { type:'done', order } (or, for the
// trial, { type:'trial', scorecard }) — { type:'error' } on a failed run. A
// rejected plan (bad shape / not-your-neuma / offline) comes back as a normal
// JSON error before any stream starts.

import { apiCall, authHeadersOrNull } from '../../utils/http.js';

// impure — shared SSE POST: one parser for every team stream. The stream keeps
// its own fetch: apiCall resolves a parsed JSON body, a live SSE body must be
// read through a reader.
const streamTeam = async (path, body, onEvent) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'Not authenticated.' };

  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Could not reach the platform.' };
  }

  if (!res.ok) {
    const body2 = await res.json().catch(() => ({}));
    return { ok: false, error: body2?.error || 'The team could not run.' };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop();
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(6))); } catch { /* skip a malformed frame */ }
    }
  }
  return { ok: true };
};

// impure — run a composed plan; opts.name is the team's designation (e.g.
// TEAM ALPHA), opts.goal the shared goal every member's brief carries — both
// echoed back on the start event.
export const runTeamStream = (steps, onEvent, opts = {}) =>
  streamTeam('/api/v1/team/run', {
    steps,
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.goal ? { goal: opts.goal } : {}),
  }, onEvent);

// impure — resume a dropped run from its record: the platform replays the
// RECORDED plan with completed steps seeded and each member's last torch
// re-armed; the stream is the same shape as a fresh run (start carries
// resumed:true and the prior truth).
export const resumeTeamStream = (runId, onEvent) =>
  streamTeam('/api/v1/team/run', { resume: runId }, onEvent);

// impure — the wallet's own team-run records, newest first (summaries; a
// non-done record is the resume affordance's feed). Discriminated result.
export const listRuns = async () => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, runs: [] };
  try {
    const data = await apiCall('GET', '/api/v1/team/runs', { headers: auth, strictJson: true });
    return { ok: true, runs: data.runs || [] };
  } catch {
    return { ok: false, runs: [] };
  }
};

// impure — one full run record (plan, completed parts, statuses, torches),
// owner-scoped. Absent-or-unowned is ok:false.
export const readRun = async (id) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, run: null };
  try {
    const data = await apiCall('GET', `/api/v1/team/runs/${encodeURIComponent(id)}`, { headers: auth, strictJson: true });
    return { ok: true, run: data.run };
  } catch {
    return { ok: false, run: null };
  }
};

// impure — every run this operator's team is working right now (board,
// torches, finished parts, each member's live words and reasoning) — what
// the desk's run store seeds from before the next frame arrives.
export const listLiveRuns = async () => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, runs: [] };
  try {
    const data = await apiCall('GET', '/api/v1/team/live', { headers: auth, strictJson: true });
    return { ok: true, runs: data.runs || [] };
  } catch {
    return { ok: false, runs: [] };
  }
};

// impure — RESUME: pick a crashed, failed or stopped lead run up where it
// stopped — its finished parts stand, only what was left runs.
export const resumeTeamRun = async (id) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'Not authenticated.' };
  try {
    const data = await apiCall('POST', `/api/v1/team/live/${encodeURIComponent(id)}/resume`, { headers: auth, body: {} });
    return { ok: true, runId: data.runId };
  } catch (err) {
    return { ok: false, error: err.message || 'The run could not be picked up.' };
  }
};

// impure — STOP: the whole run, or (stepId) one member. The stop reaches the
// member's decode; the board and the done frame report what it did.
export const stopTeamRun = async (id, stepId = null) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'Not authenticated.' };
  try {
    await apiCall('POST', `/api/v1/team/live/${encodeURIComponent(id)}/stop`, {
      headers: auth, body: stepId ? { stepId } : {},
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'The stop did not reach the run.' };
  }
};

// impure — the operator's word in the TEAM CHANNEL: to everyone, or (to) one
// member by name or step — read when they look; it never cuts their work.
export const postToTeam = async (id, text, to = null) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'Not authenticated.' };
  try {
    const data = await apiCall('POST', `/api/v1/team/live/${encodeURIComponent(id)}/channel`, {
      headers: auth, body: { text, ...(to ? { to } : {}) },
    });
    return { ok: true, message: data.message };
  } catch (err) {
    return { ok: false, error: err.message || 'The post did not reach the team.' };
  }
};

// impure — ONE member's work log for its part (every attempt, its reasoning,
// acts and words), read on from `from` — the entries a window already holds.
export const readPartLog = async (id, stepId, from = 0) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'Not authenticated.' };
  try {
    const data = await apiCall('GET', `/api/v1/team/runs/${encodeURIComponent(id)}/log/${encodeURIComponent(stepId)}?from=${from}`, { headers: auth, strictJson: true });
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message || 'The member\'s log could not be read.' };
  }
};

// impure — the operator's hand on a working run's WIDTH and CLOCKS (#577):
// { concurrency?, clock?, stepId? } — the server answers what now governs it,
// or why the change was refused (its words name the fix).
export const tuneTeamRun = async (id, change) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'Not authenticated.' };
  try {
    const data = await apiCall('POST', `/api/v1/team/live/${encodeURIComponent(id)}/tune`, { headers: auth, body: change });
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message || 'The change did not reach the run.' };
  }
};

// impure — STEER one member: the operator's note reaches it; a working member
// is paused and continues its part with it (`cut` says which happened).
export const steerTeamMember = async (id, stepId, note) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'Not authenticated.' };
  try {
    const data = await apiCall('POST', `/api/v1/team/live/${encodeURIComponent(id)}/steer`, {
      headers: auth, body: { stepId, note },
    });
    return { ok: true, cut: data.cut === true };
  } catch (err) {
    return { ok: false, error: err.message || 'The note did not reach the member.' };
  }
};

// impure — run BRICKWORKS, the locked team benchmark, with the given members
// and 0..3 refinement loops (waves stream back as { type:'wave' } events).
export const runTrialStream = (members, loops, onEvent) =>
  streamTeam('/api/v1/team/trial', { members, loops }, onEvent);

// impure — the trial's locked prompts (what each seat is asked, verbatim).
// Discriminated: a failed fetch is ok:false, never an empty spec.
export const loadTrialSpec = async () => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, spec: null };
  try {
    const spec = await apiCall('GET', '/api/v1/team/trial/spec', { headers: auth, strictJson: true });
    return { ok: true, spec };
  } catch {
    return { ok: false, spec: null };
  }
};

// impure — one of the wallet's past scorecards IN FULL (the artifact rides
// along so the game can be replayed). Absent-or-unowned is ok:false.
export const readTrial = async (id) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, trial: null };
  try {
    const data = await apiCall('GET', `/api/v1/team/trial/${encodeURIComponent(id)}`, { headers: auth, strictJson: true });
    return { ok: true, trial: data.trial };
  } catch {
    return { ok: false, trial: null };
  }
};

// impure — the wallet's past trial scorecards, newest first (summaries; no
// artifact HTML). Discriminated result: a failed fetch is `ok: false`, never
// silently indistinguishable from "no trials yet".
export const listTrials = async () => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, trials: [] };
  try {
    const data = await apiCall('GET', '/api/v1/team/trial', { headers: auth, strictJson: true });
    return { ok: true, trials: data.trials || [] };
  } catch {
    return { ok: false, trials: [] };
  }
};

// impure — the one-shot trial shelf: every community benchmark in this rig's
// pack (meta only; the composed invocation is fetched at start).
export const listBenches = async () => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, benches: [] };
  try {
    const data = await apiCall('GET', '/api/v1/team/benches', { headers: auth, strictJson: true });
    return { ok: true, benches: data.benches || [] };
  } catch {
    return { ok: false, benches: [] };
  }
};

// impure — a finished run's delivery: the workspace walked live (files as
// they are NOW, after the LEAD's assembly and fixes). Owner-scoped.
export const readRunDelivery = async (id) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, delivery: null };
  try {
    const data = await apiCall('GET', `/api/v1/team/delivery/${encodeURIComponent(id)}`, { headers: auth, strictJson: true });
    return { ok: true, delivery: data.delivery || null };
  } catch {
    return { ok: false, delivery: null };
  }
};

// impure — one delivered file as viewer DATA (text or base64) for the stream:
// images render, HTML/SVG runs sandboxed, code reads inline.
export const readRunDeliveryFile = async (id, file) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'NOT SIGNED IN' };
  try {
    const body = await apiCall('GET', `/api/v1/team/delivery/${encodeURIComponent(id)}/file?file=${encodeURIComponent(file)}`, { headers: auth, errorPrefix: 'THE PLATFORM DID NOT ANSWER' });
    return { ok: true, ...body };
  } catch (err) {
    return { ok: false, error: err.http ? err.message : 'THE PLATFORM DID NOT ANSWER' };
  }
};

// impure — everything a one-click trial start needs: the composed team
// invocation around the verbatim task, the arena, and the named teammates
// for the chosen LEAD. The server refuses a LEAD outside the house or a
// house too small to be a team — the error text is user-facing. qa defaults
// ON (quality-over-speed law); false is the witness's deliberate opt-out.
export const composeBenchStart = async (bench, lead, qa = true) => {
  const auth = authHeadersOrNull();
  if (!auth) return { ok: false, error: 'NOT SIGNED IN' };
  try {
    const body = await apiCall('POST', '/api/v1/team/benches/invocation', { headers: auth, body: { bench, lead, qa }, errorPrefix: 'THE PLATFORM DID NOT ANSWER' });
    return { ok: true, ...body };
  } catch (err) {
    return { ok: false, error: err.http ? err.message : 'THE PLATFORM DID NOT ANSWER' };
  }
};
