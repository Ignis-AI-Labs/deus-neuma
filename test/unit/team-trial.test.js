// team-trial.test.js — BRICKWORKS, the locked benchmark, proven pure + real disk.
//
// The plan builder, artifact extractor, and scorer are pure — real inputs, real
// outputs, no mock. The scorer's PASS path is proven against a genuine
// hand-written mini-game that satisfies the contract, and its failure paths
// against genuinely broken documents. The store is proven on real disk under
// NEUMA_TEAM_TRIAL_PATH. The full run against a live substrate is the
// integration/e2e tier's job.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  TRIAL_NAME,
  TRIAL_VERSION,
  TRIAL_ROLES,
  buildTrialPlan,
  leadOf,
  extractArtifact,
  scoreTrial,
} from '../../backend/services/team-trial.js';
import { validatePlan, buildBrief } from '../../backend/services/team-coordinator.js';
import { writeTrial, readTrial, listTrials } from '../../backend/services/team-trial-store.js';

// A REAL minimal game satisfying every static contract check — what a capable
// WARDEN should produce the shape of. Hand-written, not model output.
const GOOD_GAME = `<!DOCTYPE html>
<html><head><style>body{background:#111}canvas{display:block;margin:auto}</style></head>
<body><canvas id="game" width="480" height="360"></canvas>
<script>
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let ball = { x: 240, y: 300, vx: 2, vy: -2 };
let paddle = { x: 200 };
let bricks = [];
let score = 0;
let running = false;
for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) bricks.push({ x: c * 60, y: r * 20, alive: true });
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') paddle.x -= 20;
  if (e.key === 'ArrowRight') paddle.x += 20;
});
canvas.addEventListener('mousemove', (e) => { paddle.x = e.offsetX - 40; });
function tick() {
  ball.x += ball.vx; ball.y += ball.vy;
  if (ball.x < 0 || ball.x > 480) ball.vx *= -1;
  if (ball.y < 0) ball.vy *= -1;
  if (ball.y > 340 && ball.x > paddle.x && ball.x < paddle.x + 80) ball.vy *= -1;
  if (ball.y > 360) running = false;
  for (const b of bricks) {
    if (b.alive && ball.x > b.x && ball.x < b.x + 60 && ball.y > b.y && ball.y < b.y + 20) {
      b.alive = false; score += 1; ball.vy *= -1;
    }
  }
  ctx.clearRect(0, 0, 480, 360);
  ctx.fillRect(paddle.x, 344, 80, 8);
  ctx.beginPath(); ctx.arc(ball.x, ball.y, 5, 0, 7); ctx.fill();
  for (const b of bricks) if (b.alive) ctx.fillRect(b.x + 1, b.y + 1, 58, 18);
  if (running) requestAnimationFrame(tick);
}
window.__bench = {
  start() { running = true; requestAnimationFrame(tick); },
  state() { return { ball: { x: ball.x, y: ball.y }, paddle: { x: paddle.x }, bricks: bricks.filter(b => b.alive).length, score, running }; },
};
</script></body></html>`;

const fullResults = (warden) => ({
  helm: 'the spec', wright: 'the engine', smith: 'the look', warden,
});

describe('buildTrialPlan (pure) — the locked diamond', () => {
  it('four members: one role each, and the plan is a valid coordinator DAG', () => {
    const plan = buildTrialPlan(['w', 'x', 'y', 'z']);
    expect(plan.map((s) => [s.id, s.role, s.neumaId])).toEqual([
      ['helm', 'HELM', 'w'], ['wright', 'WRIGHT', 'x'], ['smith', 'SMITH', 'y'], ['warden', 'WARDEN', 'z'],
    ]);
    expect(() => validatePlan(plan)).not.toThrow();
  });

  it('the diamond edges hold: helm → (wright ∥ smith) → warden', () => {
    const byId = Object.fromEntries(buildTrialPlan(['a']).map((s) => [s.id, s.needs]));
    expect(byId).toEqual({ helm: [], wright: ['helm'], smith: ['helm'], warden: ['wright', 'smith'] });
  });

  it('fewer members than roles: roles wrap round-robin, every role still held', () => {
    const plan = buildTrialPlan(['a', 'b']);
    expect(plan.map((s) => s.neumaId)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('a single being may hold the whole trial (solo baseline)', () => {
    expect(new Set(buildTrialPlan(['solo']).map((s) => s.neumaId))).toEqual(new Set(['solo']));
  });

  it('rejects zero, six, and blank members', () => {
    expect(() => buildTrialPlan([])).toThrow(/1 to 5/);
    expect(() => buildTrialPlan(['a', 'b', 'c', 'd', 'e', 'f'])).toThrow(/1 to 5/);
    expect(() => buildTrialPlan([''])).toThrow(/neumaId/);
  });

  it('v3: explicit seats allow repeats — one being may hold several seats', () => {
    const plan = buildTrialPlan(['a', 'b', 'a', 'b', 'a']);
    expect(plan.map((s) => s.neumaId)).toEqual(['a', 'b', 'a', 'b']);
    expect(leadOf(['a', 'b', 'a', 'b', 'a'])).toBe('a');
  });

  it('the LEAD seat: fifth of an explicit assignment; round-robin otherwise', () => {
    expect(leadOf(['h', 'w', 's', 'ward', 'lead'])).toBe('lead');
    expect(leadOf(['a', 'b', 'c', 'd'])).toBe('a'); // 4 members: the spec author leads
    expect(leadOf(['solo'])).toBe('solo');
  });

  it('every locked task carries the contract, and the brief carries the role', () => {
    const plan = buildTrialPlan(['a']);
    for (const s of plan) expect(s.task).toContain('THE CONTRACT');
    const msgs = buildBrief(plan[3], { wright: 'W', smith: 'S' }, plan);
    expect(msgs[0].content).toContain('Your role: WARDEN.');
    expect(msgs[0].content).toContain('WRIGHT —');
    expect(msgs[0].content).toContain('SMITH —');
  });

  it('the benchmark is versioned — comparability across time is explicit', () => {
    expect(TRIAL_NAME).toBe('brickworks');
    expect(TRIAL_VERSION).toBe(3); // v3 = LEAD orchestration + explicit seats
    expect(Object.isFrozen(TRIAL_ROLES)).toBe(true);
  });
});

describe('extractArtifact (pure)', () => {
  it('pulls a fenced ```html block', () => {
    const out = 'Review done.\n```html\n<!DOCTYPE html><html><body>x</body></html>\n```\nShip it.';
    expect(extractArtifact(out)).toBe('<!DOCTYPE html><html><body>x</body></html>');
  });

  it('accepts a bare complete document (fencing is not the capability under test)', () => {
    expect(extractArtifact(`prose before <!DOCTYPE html>\n<html><body>x</body></html> after`))
      .toBe('<!DOCTYPE html>\n<html><body>x</body></html>');
  });

  it('returns null when no document is present', () => {
    expect(extractArtifact('I could not finish the integration.')).toBeNull();
    expect(extractArtifact('')).toBeNull();
    expect(extractArtifact(undefined)).toBeNull();
  });
});

describe('scoreTrial (pure) — objective checks, honest verdicts', () => {
  it('a genuine contract-satisfying game scores PASS with full checks', () => {
    const { checks, artifact, score } = scoreTrial({ results: fullResults('```html\n' + GOOD_GAME + '\n```') });
    expect(checks).toEqual({
      completed: true, artifact: true, canvas: true, bench: true,
      rafLoop: true, input: true, syntaxValid: true, selfContained: true,
    });
    expect(artifact).toContain('<canvas id="game"');
    expect(score).toEqual({ points: 8, max: 8, verdict: 'PASS' });
  });

  it('an incomplete run is FAIL — a missing step cannot be papered over', () => {
    const { checks, score } = scoreTrial({ results: { helm: 'spec', wright: 'engine' } });
    expect(checks.completed).toBe(false);
    expect(score.verdict).toBe('FAIL');
  });

  it('a WARDEN reply with no document is FAIL', () => {
    const { checks, score } = scoreTrial({ results: fullResults('sorry, the parts did not fit together') });
    expect(checks.artifact).toBe(false);
    expect(score.verdict).toBe('FAIL');
  });

  it('a syntax-broken game is PARTIAL at best — it can never play', () => {
    const broken = GOOD_GAME.replace('function tick() {', 'function tick( {');
    const { checks, score } = scoreTrial({ results: fullResults(broken) });
    expect(checks.syntaxValid).toBe(false);
    expect(score.verdict).toBe('PARTIAL');
  });

  it('a document leaning on the outside is caught — quoted, unquoted, css, network, storage', () => {
    const leaks = [
      '<script src="https://cdn.example/x.js"></script>', // quoted external resource
      '<script src=https://cdn.example/x.js></script>', // unquoted attribute
      '<style>body{background:url(https://cdn.example/bg.png)}</style>', // css url()
      '<script>fetch("https://api.example/hi")</script>', // network call
      '<script>const s = new WebSocket("wss://x")</script>', // socket
      '<script>localStorage.setItem("hs", "1")</script>', // storage (throws in the sandbox anyway)
      '<script>document.cookie = "a=1"</script>', // cookie
    ];
    for (const leak of leaks) {
      const leaky = GOOD_GAME.replace('<style>', `${leak}<style>`);
      expect(scoreTrial({ results: fullResults(leaky) }).checks.selfContained, leak).toBe(false);
    }
    // And the clean game still reads as self-contained.
    expect(scoreTrial({ results: fullResults(GOOD_GAME) }).checks.selfContained).toBe(true);
  });

  it('a game missing the __bench probe surface cannot PASS (the live tier needs it)', () => {
    const blind = GOOD_GAME.replaceAll('__bench', 'hooks');
    const { checks, score } = scoreTrial({ results: fullResults(blind) });
    expect(checks.bench).toBe(false);
    expect(score.verdict).toBe('PARTIAL');
  });
});

describe('team-trial-store — real disk, isolated dir, owner-scoped', () => {
  let dir;
  beforeEach(async () => { dir = await createTempDir('team-trial'); process.env.NEUMA_TEAM_TRIAL_PATH = dir; });
  afterEach(async () => { delete process.env.NEUMA_TEAM_TRIAL_PATH; await fs.rm(dir, { recursive: true, force: true }); });

  const OWNER = '0xAaAA000000000000000000000000000000000001';
  const OTHER = '0xBBbb000000000000000000000000000000000002';

  const card = (runAt, verdict = 'PASS', by = OWNER.toLowerCase()) => ({
    trial: TRIAL_NAME, version: TRIAL_VERSION, by, runAt,
    substrate: { provider: 'lm-studio', model: 'qwen3.5-122b-a10b' },
    score: { points: 8, max: 8, verdict },
    artifact: '<html>game</html>',
  });

  it('writes one file per run and the owner reads it back whole (artifact included)', async () => {
    const id = await writeTrial(card('2026-07-05T10:00:00.000Z'));
    const back = await readTrial(id, OWNER); // case-insensitive wallet match
    expect(back.artifact).toBe('<html>game</html>');
    expect(back.version).toBe(TRIAL_VERSION);
    expect((await fs.readdir(dir)).length).toBe(1);
  });

  it('NEVER overwrites — a same-millisecond runAt collision gets an ordinal, both records survive', async () => {
    const first = await writeTrial(card('2026-07-05T10:00:00.000Z'));
    const second = await writeTrial(card('2026-07-05T10:00:00.000Z', 'FAIL'));
    expect(second).toBe(`${first}-2`);
    expect((await fs.readdir(dir)).length).toBe(2);
    expect((await readTrial(first, OWNER)).score.verdict).toBe('PASS'); // the first record intact
    expect((await readTrial(second, OWNER)).score.verdict).toBe('FAIL');
  });

  it('refuses a scorecard with no provenance or no owner', async () => {
    await expect(writeTrial(card(undefined))).rejects.toThrow(/runAt/);
    const orphan = card('2026-07-05T10:00:00.000Z');
    delete orphan.by;
    await expect(writeTrial(orphan)).rejects.toThrow(/owning wallet/);
  });

  it("another wallet's card reads as ABSENT — list and read are owner-scoped", async () => {
    const id = await writeTrial(card('2026-07-05T10:00:00.000Z'));
    expect(await readTrial(id, OTHER)).toBeNull();
    expect(await listTrials(OTHER)).toEqual([]);
    expect((await listTrials(OWNER)).length).toBe(1);
  });

  it('a legacy card with no owner is owned by NO ONE, not everyone', async () => {
    await fs.writeFile(join(dir, 'legacy.json'), JSON.stringify({ id: 'legacy', runAt: '2026-07-01T00:00:00.000Z', score: {} }));
    expect(await readTrial('legacy', OWNER)).toBeNull();
    expect(await listTrials(OWNER)).toEqual([]);
  });

  it('lists newest first, as summaries — no artifact HTML in the list', async () => {
    await writeTrial(card('2026-07-05T10:00:00.000Z'));
    await writeTrial(card('2026-07-05T11:00:00.000Z', 'PARTIAL'));
    const trials = await listTrials(OWNER);
    expect(trials.map((t) => t.score.verdict)).toEqual(['PARTIAL', 'PASS']);
    expect(trials[0].artifact).toBeUndefined();
    expect(trials[0].hasArtifact).toBe(true);
  });

  it('a corrupt file is skipped, never fabricated', async () => {
    await writeTrial(card('2026-07-05T10:00:00.000Z'));
    await fs.writeFile(join(dir, 'junk.json'), '{not json');
    expect((await listTrials(OWNER)).length).toBe(1);
  });

  it('readTrial refuses a path-shaped id', async () => {
    expect(await readTrial('../../etc/passwd', OWNER)).toBeNull();
  });
});
