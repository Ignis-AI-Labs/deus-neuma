// Injection sightings — text shaped like an attack on a being, seen where it
// enters the being's context, filed in the house's threat ledger so the CSO
// and the operator see it (security-seat G13, 2026-10-19).
//
// Before this, a page that told a being […]
// was seen by nobody: the being might refuse it, but no record of the attempt
// reached the office that watches the house. The rogue-pattern detector
// already knew those shapes; it simply never looked at what arrived.
//
// A FLAG, NEVER A BLOCK. The being still reads the content (framed, with the
// wrapper's tags neutralised — tool-exchange.js, untrusted-content.js) and
// still decides. A sighting is `medium`: something tried, nothing broke.
// One row per (lane, source, UTC day): a being re-reading the same poisoned
// file all afternoon refreshes one row, it does not flood the ledger.
//
// Never the content itself: the summary carries the pattern ids, where the
// text came from, and at most a 120-character excerpt with every secret
// shape masked — the ledger is read into the CSO's own context, so a quoted
// payload would be the same attack one hop later.

import { detectRoguePatterns } from '../rogue-detector.js';
import { scanText, SECRET_PATTERNS } from './secret-sweep.js';
import { threatLedgerFor } from './threat-ledger.js';
import { createLogger } from '../logger.js';

const log = createLogger('InjectionSightings');

// A result can be a whole file; the detector's patterns are cheap, but the
// turn waits on the synchronous part, so the read is bounded.
const SCAN_MAX_CHARS = 512 * 1024;
const EXCERPT_MAX = 120;

const GLOBAL_SECRET_PATTERNS = Object.freeze(SECRET_PATTERNS.map(({ id, regex }) => ({
  id, regex: new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`),
})));

// pure — every secret shape in a line replaced by its pattern id. Masked
// BEFORE the excerpt is cut, so a key straddling the cut cannot leak half.
const maskSecrets = (line) => GLOBAL_SECRET_PATTERNS
  .reduce((out, { id, regex }) => out.replace(regex, `[${id} masked]`), line);

// pure — the first line the detector flags, masked and bounded; withheld
// whole if any secret shape survived the mask.
const excerptOf = (text) => {
  const lines = text.split('\n');
  const hit = lines.find((line) => !detectRoguePatterns(line, { toolCallCount: 0 }).safe) ?? lines[0];
  const excerpt = maskSecrets(hit).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX);
  return scanText(excerpt).length === 0 ? excerpt : '[withheld: it carried a secret shape]';
};

/**
 * The ledger finding for one piece of untrusted text, or null when the
 * detector sees nothing. Pure.
 * @param {{lane: string, kind: string, source: string, origin: string, text: string, at: string}} sighting
 *   kind — what the text was ('tool result', 'council speech', …);
 *   source — the row identity's source (the tool label, 'council', …);
 *   origin — where it came from, in words; at — ISO time of the sighting
 * @returns {Object|null} a threat-ledger finding
 */
export const injectionFinding = ({ lane, kind, source, origin, text, at }) => {
  if (typeof text !== 'string' || !text || !lane || !source) return null;
  // The tool-count heuristic judges a being's OWN output; in what it read, a
  // document listing tool calls is not a sighting.
  const scanned = text.slice(0, SCAN_MAX_CHARS);
  const { flags } = detectRoguePatterns(scanned, { toolCallCount: 0 });
  if (flags.length === 0) return null;
  const ids = flags.map((f) => f.id).join(', ');
  return {
    layer: 'house',
    source: 'injection',
    externalId: `injection:${lane}:${source}:${at.slice(0, 10)}`,
    title: `injection-shaped text in a ${kind} (${source}) read by lane ${lane}`,
    severity: 'medium',
    summary: `The rogue-pattern detector flagged ${ids} in a ${kind} from ${origin}, entering lane ${lane}'s context. `
      + 'A sighting, not a breach: nothing was blocked, and the being still decided for itself. '
      + `Excerpt, secrets masked: "${excerptOf(scanned)}"`,
    surfaces: [lane],
  };
};

/**
 * File one sighting in the house's ledger. impure, and FIRE-AND-FORGET BY
 * DESIGN: callers never await it. A ledger write that failed is logged and
 * swallowed here because a sighting is a record for the CSO, never a gate —
 * a full disk or a busy lock must not cost a being its turn, and the
 * content was already framed for the being either way. Resolves to the
 * finding filed, or null.
 * @param {{wallet: string|null|undefined, lane: string, kind: string, source: string, origin: string, text: string}} sighting
 * @returns {Promise<Object|null>} never rejects
 */
export const noteInjectionSighting = async ({ wallet, ...sighting }) => {
  try {
    if (!wallet) return null; // no house, no ledger to file in
    const finding = injectionFinding({ ...sighting, at: new Date().toISOString() });
    if (!finding) return null;
    await (await threatLedgerFor(wallet)).ingest([finding]);
    return finding;
  } catch (err) {
    log.warn('injection sighting not recorded — the turn goes on', {
      lane: sighting.lane, source: sighting.source, error: err.message,
    });
    return null;
  }
};

/**
 * One round's tool results, each looked at once. impure, fire-and-forget
 * (see noteInjectionSighting); resolves when every sighting settled.
 * @param {{walletAddress?: string, companion?: {neumaId?: string}}} connection
 * @param {Array<{tool: string, content?: string}>} results
 * @returns {Promise<Array<Object|null>>} never rejects
 */
export const noteToolResultSightings = (connection, results) => {
  const wallet = connection?.walletAddress;
  const lane = connection?.companion?.neumaId;
  if (!wallet || !lane || !Array.isArray(results)) return Promise.resolve([]);
  return Promise.all(results
    .filter((r) => typeof r?.content === 'string' && r.content)
    .map((r) => noteInjectionSighting({
      wallet, lane, kind: 'tool result', source: r.tool, origin: `the ${r.tool} result`, text: r.content,
    })));
};

/**
 * A run's board watch: each member check-in is looked at once, the first
 * time a board carries it. impure, fire-and-forget.
 * @param {string|null|undefined} wallet the operator's house
 * @returns {(board: Array<{id: string, neumaId: string, status?: string|null}>) => Promise<Array<Object|null>>}
 */
export const createBoardSightingWatch = (wallet) => {
  const seen = new Set();
  return (board) => Promise.all((Array.isArray(board) ? board : [])
    .filter((e) => typeof e?.status === 'string' && e.status && !seen.has(`${e.id}\n${e.status}`))
    .map((e) => {
      seen.add(`${e.id}\n${e.status}`);
      return noteInjectionSighting({
        wallet, lane: e.neumaId, kind: 'team board check-in', source: 'team-board', origin: `team step ${e.id}`, text: e.status,
      });
    }));
};
