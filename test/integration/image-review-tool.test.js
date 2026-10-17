/**
 * THE VERDICT, through the real dispatch path.
 *
 * `review_image` is driven by the REAL `handleImageTool` — the same function
 * `dispatchPlatformTool` calls on both seats — against the REAL tool-policy
 * gate, a REAL image written by the REAL `collectOutputs`, and a REAL review
 * log on disk. Nothing on the path is mocked (RULE 0).
 *
 * This leg needs no engine: reviewing never touches ComfyUI. The rendering leg
 * and the seeing leg are GPU work and are proven separately, live.
 *
 * The port functions (`sendToolEvent` and friends) are supplied here exactly as
 * `portal-stream` supplies them in production — that is the handler's contract,
 * not a stand-in for the path under test.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { handleImageTool } from '../../backend/services/image-forge/image-being-tools.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { readReviews, reviewsFor, _resetEnsured } from '../../backend/services/image-forge/review-log.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const LANE = 'reviewlane';

let dir;
let priorStore;
let priorLog;
let imageId;
let events;

// The connection shape the dispatcher hands every image tool.
const connectionFor = (laneId) => ({
  companion: { neumaId: laneId, name: 'Fenna' },
  _sessionToolPolicy: null,
  activeTurn: null,
});

const ports = () => ({
  sendToolEvent: (_ws, _companion, event) => events.push(event),
});

const review = (args, laneId = LANE) => handleImageTool(
  {}, connectionFor(laneId), null, 'act',
  { toolName: 'review_image' }, args, ports(),
);

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'review-tool-'));
  const outputDir = path.join(dir, 'out');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, 'render.png'), PNG_1X1);

  priorStore = process.env.COMFYUI_IMAGE_STORE_DIR;
  priorLog = process.env.COMFYUI_REVIEW_LOG_PATH;
  process.env.COMFYUI_IMAGE_STORE_DIR = path.join(dir, 'store');
  process.env.COMFYUI_REVIEW_LOG_PATH = path.join(dir, 'reviews.jsonl');
  _resetEnsured();

  imageId = collectOutputs({
    outputDir,
    outputs: [{ filename: 'render.png', subfolder: '', type: 'output' }],
    laneId: LANE,
    jobId: 'job-42',
    laneDir: path.join(dir, 'store', LANE),
  })[0].imageId;
  events = [];
});

afterEach(() => {
  if (priorStore === undefined) delete process.env.COMFYUI_IMAGE_STORE_DIR;
  else process.env.COMFYUI_IMAGE_STORE_DIR = priorStore;
  if (priorLog === undefined) delete process.env.COMFYUI_REVIEW_LOG_PATH;
  else process.env.COMFYUI_REVIEW_LOG_PATH = priorLog;
  rmSync(dir, { recursive: true, force: true });
});

describe('review_image — the real handler, the real disk', () => {
  test('a judgment reaches the ledger, linked to the job that made the image', () => {
    return review({
      imageId,
      matches: 'partial',
      missing: 'the second figure never appeared',
      defects: 'hands are malformed',
      verdict: 'redo',
      note: 'the light is right; the staging is not',
    }).then((res) => {
      expect(res.status).toBe('ok');

      const rows = reviewsFor(readReviews().entries, imageId);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.by).toBe('being');
      expect(row.author).toBe('Fenna');
      // The link back to what was ACTUALLY asked — the attempt log holds the
      // verbatim prompt against this same jobId.
      expect(row.jobId).toBe('job-42');
      expect(row.matches).toBe('partial');
      expect(row.missing).toBe('the second figure never appeared');
      expect(row.verdict).toBe('redo');
      expect(row.note).toContain('the staging is not');
    });
  });

  test('the being is told its judgment is its own', async () => {
    const res = await review({ imageId, matches: 'yes', verdict: 'keep' });
    expect(res.content).toContain('never over it');
    expect(events.at(-1).status).toBe('ok');
  });

  test('an invented verdict is refused before anything is written', async () => {
    const res = await review({ imageId, matches: 'yes', verdict: 'magnificent' });
    expect(res.status).toBe('error');
    expect(res.error).toContain('keep, redo, discard');
    expect(readReviews().entries).toHaveLength(0);
  });

  test('an out-of-enum adherence is refused, not silently nulled', async () => {
    // `matches` is required by the schema AND it is the objectively checkable
    // stratum. Normalizing junk to null would record a review that decided the
    // one thing it was asked to decide, and the being would never be told.
    const res = await review({ imageId, matches: 'totally', verdict: 'keep' });
    expect(res.status).toBe('error');
    expect(res.error).toContain('yes, partial, no');
    expect(readReviews().entries).toHaveLength(0);
  });

  test('an image with no id named is refused', async () => {
    const res = await review({ matches: 'yes', verdict: 'keep' });
    expect(res.status).toBe('error');
    expect(res.error).toContain('imageId');
  });

  test('a being cannot review an image that is not in its own lane', async () => {
    // The lane IS the boundary — a foreign id cannot even be confirmed to exist.
    const res = await review({ imageId, matches: 'yes', verdict: 'keep' }, 'someoneelse');
    expect(res.status).toBe('error');
    expect(res.error).toContain('in your own lane');
    expect(readReviews().entries).toHaveLength(0);
  });

  test('an id that names no record is refused, not invented', async () => {
    const res = await review({ imageId: 'not-a-real-id', matches: 'yes', verdict: 'keep' });
    expect(res.status).toBe('error');
    expect(readReviews().entries).toHaveLength(0);
  });

  test('two judgments on one image both stand — a being may change its mind', async () => {
    await review({ imageId, matches: 'yes', verdict: 'keep', note: 'first look: this works' });
    await review({ imageId, matches: 'partial', verdict: 'redo', note: 'second look: the hands are wrong' });
    const rows = reviewsFor(readReviews().entries, imageId);
    expect(rows).toHaveLength(2);
    // Newest first, and the earlier judgment is still readable — the record is
    // append-only, so a revision never erases what was thought before it.
    expect(rows[0].note).toContain('second look');
    expect(rows[1].note).toContain('first look');
  });
});
