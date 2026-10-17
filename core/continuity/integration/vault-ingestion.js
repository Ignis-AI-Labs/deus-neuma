// Vault → semantic ingestion (memory pyramid U4).
//
// The personal vault is the being's CURATION SURFACE over its own record —
// pages it writes and rewrites in its own words (vault_save, heartbeat
// seeding). U4 closes the loop in ONE direction: what the being curates
// flows back into its semantic continuity lane, so recall meets the being's
// own edits. One direction per tier — biography→vault at seeding,
// vault→semantic here — never bidirectional sync.
//
// Idempotent by content hash: an unchanged page writes nothing, every cycle
// is safe. A changed page SUPERSEDES its previous semantic record
// (supersede-not-delete: the old version stays readable in history, stamped
// with what replaced it). A page is keyed by its slug (meta.vaultSlug), so
// one page's whole life maps to one record lineage.
//
// The expiry sweep: vault pages can now be renamed and archived (stamp-and-
// retain — never deleted). A slug that has left the LIVE list no longer
// stands in the being's working curation, so its semantic record expires the
// same way an edit supersedes — stamped at the sweep instant, never erased.
// A rename reads as old-slug-expired + new-slug-ingested; an archived page
// simply expires until it is restored.

import crypto from 'crypto';
import { makeRecord } from '../record.js';
import { WorkspaceAdapter } from '../adapters/workspace.js';

// pure — one page's identity-of-content; title edits count as edits.
const contentHashOf = (note) =>
  crypto.createHash('sha256').update(`${note.title}\n${note.body}`).digest('hex');

/**
 * Ingest one being's personal-vault pages into its semantic continuity lane.
 * @param {Object} workspace - the NeumaWorkspace singleton (or a test instance)
 * @param {string} neumaId
 * @param {{now?: string}} [opts] - injectable clock for deterministic tests
 * @returns {Promise<{ingested: string[], superseded: string[], unchanged: string[], expired: string[]}>}
 *   slugs by outcome — ingested (first landing), superseded (page edited),
 *   unchanged (hash match, nothing written), expired (slug left the live
 *   vault — renamed away or archived)
 */
// impure — reads the vault + semantic lane, appends new/superseding/expiry records
export async function ingestVaultIntoContinuity(workspace, neumaId, { now = new Date().toISOString() } = {}) {
  if (typeof neumaId !== 'string' || !neumaId) {
    throw new Error('ingestVaultIntoContinuity: neumaId required');
  }
  const adapter = new WorkspaceAdapter(neumaId, { workspace });
  const notes = await workspace.listVaultNotes(neumaId);
  const results = { ingested: [], superseded: [], unchanged: [], expired: [] };

  const semantic = await adapter.list('semantic');
  const bySlug = new Map(
    semantic
      .filter((r) => r.meta?.source === 'vault' && typeof r.meta?.vaultSlug === 'string')
      .map((r) => [r.meta.vaultSlug, r])
  );

  // The sweep runs even on an empty vault: a being that archived every page
  // still owes its semantic lane the expiry of what left. Already-expired
  // records fold out of the current view above, so nothing expires twice.
  const liveSlugs = new Set(notes.map((n) => n.slug));
  for (const [slug, prior] of bySlug) {
    if (liveSlugs.has(slug)) continue;
    await adapter.expire('semantic', prior.id, { at: now });
    bySlug.delete(slug);
    results.expired.push(slug);
  }

  for (const note of notes) {
    const contentHash = contentHashOf(note);
    const prior = bySlug.get(note.slug) ?? null;
    if (prior && prior.meta.contentHash === contentHash) {
      results.unchanged.push(note.slug);
      continue;
    }
    const record = makeRecord({
      layer: 'semantic',
      content: `# ${note.title}\n\n${note.body}`,
      occurredAt: note.updatedAt || now,
      meta: { source: 'vault', vaultSlug: note.slug, contentHash },
      ...(prior ? { supersedes: prior.id } : {}),
    }, { now });
    if (prior) {
      // Crash-safe ordering (echo r1): EXPIRE the prior first, THEN append
      // the replacement. A crash between the two leaves a GAP — the slug
      // folds as unseen and the next heartbeat re-ingests it fresh — never
      // TWO current records for one page (append-first would fork the
      // lineage, and the bySlug lookup is last-key-wins). The expiry marker
      // already names its successor: the record id exists before either write.
      await adapter.expire('semantic', prior.id, { at: now, supersededBy: record.id });
      await adapter.append(record);
      results.superseded.push(note.slug);
    } else {
      await adapter.append(record);
      results.ingested.push(note.slug);
    }
  }
  return results;
}
