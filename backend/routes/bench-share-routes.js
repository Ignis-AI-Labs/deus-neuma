/**
 * Bench SUMMARY + SHARE routes — a sub-router mounted INSIDE the bench router
 * (after its requireAuth and harness gate), so every answer here is the
 * operator's and a machine without the harness degrades to the same 503.
 *
 *   GET /summary              — every comparable series per suite, the
 *                               catalog cells never taken, the proof history
 *                               (each with its chart model)
 *   GET /share?kind&id&size   — the card's Markdown table + its PNG filename
 *   GET /share/png?kind&id&size — the card, faces embedded, as PNG (the
 *                               desk previews THESE bytes: what you see posts)
 *
 * kind=series takes a series id (suite~protocol~samples, from /summary);
 * kind=proof takes a proof id. Both ids are charset-validated before any lookup.
 */

import express from 'express';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listCells } from '../services/bench/bench-catalog.js';
import {
  suitesSummary, notTakenCells, readAllRunReceipts, readProofHistory, projectProof,
} from '../services/bench/bench-summary.js';
import { readProof } from '../services/bench/proof-certificate.js';
import {
  CARD_SIZES, CARD_FACES, chartFromSeries, chartFromProof, renderShareCardSvg, shareMarkdown,
} from '../services/bench/bench-share-card.js';
import { embedFaces } from '../services/branding/brand-tokens.js';
import { fontFaceBlock } from '../services/branding/card-svg.js';
import { chromiumRasterize } from '../services/branding/card-tool.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Bench');
const ID_RE = /^[A-Za-z0-9._~-]{1,160}$/;

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

/**
 * Resolve a share request to its chart model, or a refusal.
 * @returns {Promise<{ok: true, chart: object, size: string} | {ok: false, status: number, code: string, message: string}>}
 */
// impure (reads receipts / the proof)
const resolveChart = async ({ kind, id, size = '16x9' }) => {
  if (!CARD_SIZES[size]) {
    return { ok: false, status: 400, code: 'BENCH_BAD_SIZE', message: `size must be one of ${Object.keys(CARD_SIZES).join(', ')}` };
  }
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return { ok: false, status: 400, code: 'BENCH_BAD_ID', message: 'id must be a suite or proof id' };
  }
  if (kind === 'series') {
    const series = suitesSummary(await readAllRunReceipts()).flatMap((s) => s.series).find((s) => s.id === id);
    if (!series) return { ok: false, status: 404, code: 'BENCH_SERIES_NOT_FOUND', message: `no comparable series ${id}` };
    return { ok: true, chart: chartFromSeries(series), size };
  }
  if (kind === 'proof') {
    const proof = await readProof(id);
    if (!proof) return { ok: false, status: 404, code: 'BENCH_PROOF_NOT_FOUND', message: `no proof ${id}` };
    return { ok: true, chart: chartFromProof(projectProof(proof.receipt)), size };
  }
  return { ok: false, status: 400, code: 'BENCH_BAD_KIND', message: 'kind must be series or proof' };
};

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const [receipts, cells, proofs] = await Promise.all([readAllRunReceipts(), listCells(), readProofHistory()]);
    const suites = suitesSummary(receipts);
    const cellOf = new Map(cells.map((c) => [c.id, c]));
    // Each series and proof carries its chart model — the SAME law the
    // share card draws, so the desk's bars and the posted card never differ.
    res.json({
      suites: suites.map((s) => ({
        ...s,
        tier: cellOf.get(s.suiteId)?.tier ?? null,
        label: cellOf.get(s.suiteId)?.label ?? null, // the harness's own words for the variant
        series: s.series.map((x) => ({ ...x, chart: chartFromSeries(x) })),
      })),
      notTaken: notTakenCells(cells, suites),
      proofs: proofs.map((p) => ({ ...p, chart: chartFromProof(p) })),
    });
  } catch (error) {
    log.error('bench summary read failed', { error: error.message });
    fail(res, 500, 'BENCH_READ_FAILED', 'Failed to read the summary');
  }
});

router.get('/share', async (req, res) => {
  try {
    const r = await resolveChart(req.query);
    if (!r.ok) return fail(res, r.status, r.code, r.message);
    res.json({ markdown: shareMarkdown(r.chart), filename: `${r.chart.filenameStem}-${r.size}.png` });
  } catch (error) {
    log.error('bench share render failed', { error: error.message });
    fail(res, 500, 'BENCH_SHARE_FAILED', 'Failed to draw the card');
  }
});

// The PNG embeds the vendored faces so the card draws the same on any
// machine, then rasterizes through the card pipeline's own Chromium.
router.get('/share/png', async (req, res) => {
  let dir = null;
  try {
    const r = await resolveChart(req.query);
    if (!r.ok) return fail(res, r.status, r.code, r.message);
    const { faces, missing } = await embedFaces(CARD_FACES);
    if (missing.length) log.warn('bench share card faces missing', { missing });
    const { svg, width, height } = renderShareCardSvg(r.chart, { size: r.size, fontFace: fontFaceBlock(faces) });
    dir = await mkdtemp(path.join(tmpdir(), 'bench-card-'));
    const out = path.join(dir, 'card.png');
    await chromiumRasterize(svg, out, { width, height });
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${r.chart.filenameStem}-${r.size}.png"`);
    res.send(await readFile(out));
  } catch (error) {
    log.error('bench share png failed', { error: error.message });
    fail(res, 500, 'BENCH_SHARE_FAILED', `Failed to render the card: ${error.message}`);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
