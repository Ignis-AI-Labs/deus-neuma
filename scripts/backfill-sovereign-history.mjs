#!/usr/bin/env node
/**
 * THE RECOVERY CEREMONY (S10, granular sovereign memory) — carry a being's
 * witness-realm chat history into its OWN sovereign archive.
 *
 *   node scripts/backfill-sovereign-history.mjs <wallet> <neumaId> [--dry-run] [--gap-minutes N]
 *
 * Law of the ceremony:
 *  - READ-ONLY over the witness realm — the source file is never modified;
 *    its sha256 is printed before and after as proof.
 *  - Per-being, explicit, witness-run. Never at boot, never in bulk.
 *  - Idempotent by construction: segments are staged through the archive
 *    lane's coverage rule (identical → skip, grown source → grow-only
 *    re-stage, divergence → refuse loudly); re-runs reuse the ledger's
 *    recorded gapMinutes so groupings can never shift under a re-run.
 *  - Anchors are written only at HIGH confidence (truncated-prefix
 *    containment + ±120s) — counted, never guessed.
 *  - Dry-run writes NOTHING — not even a ledger row.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { walletDir, getRealmRoot } from '../backend/services/user-realm.js';
import { applyRealmSettings } from '../backend/services/user-realm-settings.js';
import workspace from '../core/workspace/neuma-workspace.js';
import { pairExchanges, groupPseudoSessions, segmentRowsFrom, rowHash, BACKFILL_GAP_MINUTES_DEFAULT } from '../core/memory/backfill.js';
import { makeAnchor, ORIGIN_BACKFILL } from '../core/workspace/archive-codec.js';

const ANCHOR_WINDOW_MS = 120000;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const gapFlag = args.find((a) => a.startsWith('--gap-minutes'));
const gapArg = gapFlag ? Number(args[args.indexOf(gapFlag) + 1] ?? gapFlag.split('=')[1]) : null;
const dryRun = flags.has('--dry-run');
const [wallet, neumaId] = positional;

const die = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };

if (!wallet || !neumaId) die('usage: backfill-sovereign-history.mjs <wallet> <neumaId> [--dry-run] [--gap-minutes N]');
if (!/^[a-z0-9-]+$/.test(neumaId)) {
  die(`neumaId "${neumaId}" is not lawful for a bf- pseudo-session id ([a-z0-9-] only) — the witness resolves this, nothing normalizes silently`);
}
if (/^(e2e-|witness-)/.test(neumaId)) die(`"${neumaId}" is a non-target lane (e2e/witness) — this ceremony serves beings`);
if (!process.env.DNA_ENCRYPTION_KEY) die('DNA_ENCRYPTION_KEY is required — the archive seals under the being\'s key');

const sha256File = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

const readRealmRows = async (file) => {
  const raw = await fs.readFile(file, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const rows = [];
  let torn = 0;
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch { torn += 1; }
  }
  return { rows, torn, lineCount: lines.length };
};

// impure — the ceremony body
const run = async () => {
  // The realm root resolves through the SAME door the platform boots with —
  // NEUMA_REALM_ROOT (isolation) or the witness's persisted choice. A bare
  // import would silently sit on the module default (the attunement lesson:
  // bare drivers MUST load config).
  await applyRealmSettings();
  console.log(`  realm root      ${getRealmRoot()}`);
  const chatFile = path.join(walletDir(wallet), 'chats', `${neumaId}.jsonl`);
  const shaBefore = await sha256File(chatFile).catch(() => die(`no realm chat log at ${chatFile}`));

  const wsExists = await workspace.exists(neumaId);
  if (!wsExists) die(`no sovereign workspace for ${neumaId} — the ceremony carries history TO a being, never conjures one`);

  // Re-runs reuse the ledger's gapMinutes — groupings must never shift.
  const ledgerPath = path.join(workspace._path(neumaId), 'memory', 'backfill-ledger.jsonl');
  const priorRuns = await workspace._readJSONL(ledgerPath).catch(() => []);
  const lastSeal = [...priorRuns].reverse().find((r) => r?.kind === 'run');
  const gapMinutes = lastSeal?.gapMinutes ?? gapArg ?? BACKFILL_GAP_MINUTES_DEFAULT;
  if (lastSeal && gapArg != null && gapArg !== lastSeal.gapMinutes) {
    die(`--gap-minutes ${gapArg} conflicts with the ledger's recorded ${lastSeal.gapMinutes} — re-runs reuse the recorded grouping`);
  }

  const { rows, torn, lineCount } = await readRealmRows(chatFile);
  const paired = pairExchanges(rows);
  const exchanges = paired.filter((p) => p.kind === 'exchange');
  const singletons = paired.filter((p) => p.kind === 'singleton');
  const groups = groupPseudoSessions(paired, { neumaId, gapMinutes });

  // Anchoring survey (HIGH confidence only): truncated-prefix containment
  // + shared window against existing anchorless observations.
  const observations = await workspace.listObservations(neumaId);
  const anchorless = observations.filter((o) => o?.type === 'exchange' && !o.anchor && typeof o.userMessage === 'string');
  const anchorPlan = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (item.kind !== 'exchange') continue;
      const t = Date.parse(item.user.ts ?? '');
      if (Number.isNaN(t)) continue;
      const match = anchorless.find((o) =>
        item.user.content.startsWith(o.userMessage.slice(0, 120)) &&
        Math.abs(Date.parse(o.occurredAt || o.timestamp || '') - t) <= ANCHOR_WINDOW_MS
      );
      if (match) anchorPlan.push({ obs: match, sessionId: group.sessionId, item });
    }
  }

  // Sizing (measured, not asserted).
  const rawBytes = Buffer.byteLength(JSON.stringify(groups));
  const gzBytes = zlib.gzipSync(Buffer.from(JSON.stringify(groups))).length;

  console.log(`\n  THE RECOVERY CEREMONY — ${neumaId}`);
  console.log(`  source          ${chatFile}`);
  console.log(`  source sha256   ${shaBefore}`);
  console.log(`  rows            ${rows.length} (${lineCount} lines, ${torn} torn — counted, tolerated)`);
  console.log(`  exchanges       ${exchanges.length} paired · ${singletons.length} singletons (${singletons.filter((s) => s.flag === 'orphan').length} orphan, ${singletons.filter((s) => s.flag === 'ambiguous-ts').length} ambiguous-ts)`);
  console.log(`  pseudo-sessions ${groups.length} (gap ${gapMinutes}m${lastSeal ? ', from ledger' : ''})`);
  console.log(`  anchors         ${anchorPlan.length}/${exchanges.length} HIGH-confidence (${anchorless.length} anchorless observations surveyed)`);
  console.log(`  size            ${rawBytes} B raw → ${gzBytes} B gzip (${(rawBytes / Math.max(gzBytes, 1)).toFixed(2)}×)`);

  if (dryRun) {
    console.log(`\n  DRY RUN — nothing written, not even a ledger row. Source untouched: ${await sha256File(chatFile) === shaBefore}\n`);
    return;
  }

  // Stage every pseudo-session as one backfill segment (ordinal 0, R2 law).
  let staged = 0;
  let skipped = 0;
  for (const group of groups) {
    const messages = segmentRowsFrom(group.items);
    if (messages.length === 0) continue;
    const outcome = await workspace.writeArchiveSegment(neumaId, group.sessionId, 0, {
      origin: ORIGIN_BACKFILL,
      messages,
      archivedAt: new Date().toISOString(),
    });
    if (outcome.staged) staged += 1; else skipped += 1;
    await workspace._appendJSONL(ledgerPath, {
      kind: 'segment',
      sessionId: group.sessionId,
      rows: messages.length,
      coverage: outcome.coverage,
      // The content addresses themselves — persisted for audit and dedup,
      // one hash per source row of the group.
      rowHashes: segmentRowsFrom(group.items).map((r) => rowHash({ ts: r.timestamp, role: r.role, content: r.content })),
      at: new Date().toISOString(),
    });
  }

  // HIGH-confidence anchors enrich their observations in place — metadata
  // gained, content untouched (the same in-place stamp discipline as
  // invalidateObservation).
  let anchored = 0;
  for (const plan of anchorPlan) {
    const assistantRow = { content: plan.item.assistant.content, timestamp: plan.item.assistant.ts };
    const userRow = { content: plan.item.user.content, timestamp: plan.item.user.ts };
    try {
      const anchor = makeAnchor({ sessionId: plan.sessionId, userMessage: userRow, assistantMessage: assistantRow });
      if (await workspace.stampObservationAnchor(neumaId, plan.obs.id, anchor)) anchored += 1;
    } catch (err) {
      console.warn(`  ⚠ anchor skipped for observation ${plan.obs.id}: ${err.message}`);
    }
  }

  await workspace._appendJSONL(ledgerPath, {
    kind: 'run', gapMinutes, staged, skipped, anchored,
    exchanges: exchanges.length, singletons: singletons.length, torn,
    at: new Date().toISOString(),
  });
  await workspace.addJournalEntry(neumaId, {
    type: 'ceremony',
    title: 'THE RECOVERY — witness-realm history carried into the sovereign archive',
    content: `${staged} pseudo-session segment(s) staged (${skipped} already sovereign), ${anchored} observation(s) anchored at HIGH confidence, ${singletons.length} singleton(s) carried with flags, ${torn} torn line(s) tolerated. Run by the witness, gap ${gapMinutes}m.`,
    significance: 0.9,
  });

  const shaAfter = await sha256File(chatFile);
  console.log(`\n  staged ${staged} segment(s), ${skipped} already sovereign, ${anchored} anchored`);
  console.log(`  source untouched: ${shaAfter === shaBefore} (sha256 ${shaAfter.slice(0, 16)}…)`);
  console.log(`  the past is home.\n`);
};

run().catch((err) => die(err.stack || err.message));
