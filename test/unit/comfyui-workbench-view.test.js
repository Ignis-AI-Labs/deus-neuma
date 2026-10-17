import { describe, test, expect } from 'vitest';
import {
  deriveForgeCard, workbenchUrl, deriveActivityRail, toActivityRow,
} from '../../frontend/app/RelinkShell/comfyui-workbench-view.js';

// The FR-37 card's state law over real supervisor snapshots — the exact
// shapes /api/v1/image-forge/status returns (asserted live in the supervisor
// integration suite). `failed` is derived from stopped+lastError so a dead
// launch is never a hung "launching…".

const installed = { installed: true, reason: null };

describe('deriveForgeCard', () => {
  test('no snapshot yet → reading, no actions', () => {
    const card = deriveForgeCard(null);
    expect(card.phase).toBe('reading');
    expect(card.canOpen).toBe(false);
  });

  test('lane absent → not-installed carries the supervisor’s named reason', () => {
    const card = deriveForgeCard({
      state: 'stopped', serving: false,
      install: { installed: false, reason: 'COMFYUI_INSTALL_DIR is empty — the lane is absent until installed' },
      lastError: null, port: 8190,
    });
    expect(card.phase).toBe('not-installed');
    expect(card.line).toContain('COMFYUI_INSTALL_DIR');
    expect(card.canOpen).toBe(false);
  });

  test('ready + owned → OPEN/FREE/STOP with the supervised sentence', () => {
    const card = deriveForgeCard({
      state: 'ready', serving: true, owned: true, adopted: false, foreign: false,
      pid: 4242, port: 8190, install: installed, lastError: null,
    });
    expect(card.phase).toBe('ready');
    expect(card.line).toContain('8190');
    expect(card.line).toContain('4242');
    expect(card.canOpen).toBe(true);
    expect(card.canStop).toBe(true);
    expect(card.stopWord).toBe('STOP');
  });

  test('ready + adopted → honest tenancy, stop becomes RELEASE', () => {
    const card = deriveForgeCard({
      state: 'ready', serving: true, owned: false, adopted: true, foreign: false,
      pid: null, port: 8190, install: installed, lastError: null,
    });
    expect(card.phase).toBe('ready');
    expect(card.line).toContain('not ours to stop');
    expect(card.stopWord).toBe('RELEASE');
  });

  test('launching → no actions, port named', () => {
    const card = deriveForgeCard({
      state: 'launching', serving: false, port: 8191, install: installed, lastError: null,
    });
    expect(card.phase).toBe('launching');
    expect(card.line).toContain('8191');
    expect(card.canOpen).toBe(false);
  });

  test('stopped + named lastError → FAILED face with the supervisor’s words, RETRY offered', () => {
    const card = deriveForgeCard({
      state: 'stopped', serving: false, foreign: false, port: 8190, install: installed,
      lastError: { error: 'ComfyUI did not answer GET /prompt within 90s — tail /data/comfyui/logs/comfyui-8190.log', at: 't' },
    });
    expect(card.phase).toBe('failed');
    expect(card.line).toContain('did not answer');
    expect(card.canOpen).toBe(true); // RETRY rides the same open action
    expect(card.canStop).toBe(false);
  });

  test('adoption refusal (stopped + foreign + named error) → failed face wins, reason shown', () => {
    const card = deriveForgeCard({
      state: 'stopped', serving: true, foreign: true, port: 8190, install: installed,
      lastError: { error: 'adoption refused — unsafe argv on port 8190: --disable-all-custom-nodes missing — zero custom nodes is launch law', at: 't' },
    });
    expect(card.phase).toBe('failed');
    expect(card.line).toContain('adoption refused');
  });

  test('foreign with no refusal yet → honest unverified-stranger line', () => {
    const card = deriveForgeCard({
      state: 'stopped', serving: true, foreign: true, port: 8190, install: installed, lastError: null,
    });
    expect(card.phase).toBe('foreign');
    expect(card.line).toContain('not supervised');
    expect(card.canOpen).toBe(true);
  });

  test('stopped clean → opening launches; the line says so', () => {
    const card = deriveForgeCard({
      state: 'stopped', serving: false, foreign: false, port: 8190, install: installed, lastError: null,
    });
    expect(card.phase).toBe('stopped');
    expect(card.line).toContain('launches');
    expect(card.canOpen).toBe(true);
  });
});

describe('workbenchUrl', () => {
  test('loopback by construction, port from the snapshot', () => {
    expect(workbenchUrl({ port: 8191 })).toBe('http://127.0.0.1:8191/');
    expect(workbenchUrl(null)).toBe('http://127.0.0.1:8190/');
  });
});

// The rail's law over the exact shape GET /api/v1/image-forge/activity returns
// (the same records forge-activity.js folds, asserted in its own suite).
describe('deriveActivityRail', () => {
  test('no snapshot yet → idle, no rows', () => {
    const rail = deriveActivityRail(null);
    expect(rail).toEqual({ rows: [], liveCount: 0, idle: true });
  });

  test('live rows lead the recent tail — what is happening now is never buried', () => {
    const rail = deriveActivityRail({
      live: [{ jobId: 'now', phase: 'rendering' }],
      recent: [{ jobId: 'before', phase: 'done' }],
    });
    expect(rail.rows.map((r) => r.jobId)).toEqual(['now', 'before']);
    expect(rail.liveCount).toBe(1);
    expect(rail.idle).toBe(false);
  });

  test('survives a malformed snapshot rather than throwing in the render path', () => {
    expect(deriveActivityRail({ live: 'nope' }).idle).toBe(true);
    expect(deriveActivityRail(undefined).idle).toBe(true);
  });
});

describe('toActivityRow', () => {
  test('a rendering row carries the being, pipeline and percent', () => {
    const row = toActivityRow({
      jobId: 'j', phase: 'rendering', beingName: 'Fenna',
      pipelineLabel: 'SDXL text-to-image', percent: 58,
    });
    expect(row).toMatchObject({
      word: 'RENDERING', who: 'Fenna', pipeline: 'SDXL text-to-image',
      percent: 58, live: true, bad: false,
    });
  });

  test('falls back to the lane id, never a guess at who rendered', () => {
    expect(toActivityRow({ jobId: 'j', laneId: 'witness-xai-Grok' }).who).toBe('witness-xai-Grok');
    expect(toActivityRow({ jobId: 'j' }).who).toBe('a being');
  });

  test('a refusal reads as bad and settled', () => {
    const row = toActivityRow({ jobId: 'j', phase: 'refused', detail: 'refused by content law (minor_sexual)' });
    expect(row).toMatchObject({ word: 'REFUSED', live: false, bad: true });
  });

  test('percent is null unless the engine gave a real number — no 0% lie', () => {
    expect(toActivityRow({ jobId: 'j', phase: 'queued' }).percent).toBeNull();
    expect(toActivityRow({ jobId: 'j', percent: 0 }).percent).toBe(0);
  });

  test('images default to an empty list so the thumb map never throws', () => {
    expect(toActivityRow({ jobId: 'j' }).images).toEqual([]);
    expect(toActivityRow({ jobId: 'j', images: [{ imageId: 'x' }] }).images).toHaveLength(1);
  });
});
