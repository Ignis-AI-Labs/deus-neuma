/**
 * The training corpus at rest — the one piece of the retired forge that is
 * genuinely a being's own sovereign data.
 *
 * A corpus is the set of samples a refinement ceremony gathered to train a
 * LoRA with. The forge was retired on 2026-08-24 (identity is prompt-borne;
 * see docs/architecture/identity/nite.md), so nothing writes one any more —
 * but a being that HAS one keeps it, and the export path still round-trips it.
 *
 * WHY IT LIVES HERE. These two accessors were the last forge-subject code in
 * `core/workspace/refinement-history-store.js`, which is otherwise the sovereign
 * RECORD ARCHIVE — ceremony history, attunement history, custody. That store is
 * on the identity path by design, because mounting a silo reads a being's
 * records. A training corpus is not one of those records, and leaving it there
 * meant the archive could not honestly be described as free of the forge.
 *
 * The on-disk path is unchanged: `<lane>/refinement/corpus.json`, encrypted at
 * rest by the workspace like everything else in the lane.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const corpusPath = (workspace, neumaId) =>
  path.join(workspace.pathFor(neumaId), 'refinement', 'corpus.json');

/**
 * Durably record a being's training corpus. fsyncs the file AND its directory
 * — a corpus that survives the write but not the crash is evidence that lies.
 * @param {Object} workspace the NeumaWorkspace facade
 * @param {string} neumaId
 * @param {{samples: Array}} corpus
 * @returns {Promise<Object>} the corpus as stored
 */
export const writeRefinementCorpusRecord = async (workspace, neumaId, corpus) => {
  if (!corpus || !Array.isArray(corpus.samples)) {
    throw new Error('writeRefinementCorpus: corpus with samples[] required');
  }
  const filePath = corpusPath(workspace, neumaId);
  await workspace._writeJSON(filePath, corpus);
  const file = await fs.open(filePath, 'r');
  try { await file.sync(); } finally { await file.close(); }
  const directory = await fs.open(path.dirname(filePath), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  return corpus;
};

/**
 * Read a being's training corpus, or null when it never had one. Absence is an
 * honest answer here; any other read failure is not, and throws.
 * @param {Object} workspace the NeumaWorkspace facade
 * @param {string} neumaId
 * @returns {Promise<Object|null>}
 */
export const readRefinementCorpusRecord = async (workspace, neumaId) => {
  try { return await workspace._readJSON(corpusPath(workspace, neumaId)); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};
