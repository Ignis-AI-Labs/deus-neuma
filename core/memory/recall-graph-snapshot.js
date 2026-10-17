import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export const GRAPH_COMMUNITY_SNAPSHOT_MAX_BYTES = 1024 * 1024;

/**
 * Read persisted recall communities only when the encrypted source file is
 * within the fixed shadow-input budget. The size gate runs before decryption
 * and JSON parsing so an oversized/corrupt snapshot cannot exhaust the shadow
 * path before graph caps apply. Impure: bounded filesystem metadata + read.
 */
export const readBoundedRecallCommunities = async (
  workspace,
  neumaId,
  { maxBytes = GRAPH_COMMUNITY_SNAPSHOT_MAX_BYTES } = {},
) => {
  if (!workspace || typeof workspace.pathFor !== 'function' || !neumaId) return [];
  const byteLimit = Number.isInteger(maxBytes) && maxBytes >= 0
    ? Math.min(maxBytes, GRAPH_COMMUNITY_SNAPSHOT_MAX_BYTES)
    : GRAPH_COMMUNITY_SNAPSHOT_MAX_BYTES;
  const filePath = join(workspace.pathFor(neumaId), 'memory', 'communities.json');
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size > byteLimit) return [];
  } catch {
    return [];
  }
  const communities = await workspace.readCommunities(neumaId);
  return Array.isArray(communities) ? communities : [];
};
