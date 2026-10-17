// impure: platform control metadata is not an ordinary writable lane artifact.
import fs from 'node:fs/promises';
import path from 'node:path';

const REFUSAL = 'Coding shell control state is platform-managed. Use coding/sandbox_recover; preserved upper artifacts remain readable for harvest.';
const GENERATION = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Refuse control writes and ancestor replacements. Existing upper descendants
 * are authored artifacts, not authority; never create a generation through them. */
export const codingShellMutationReason = async (filePath, laneRoot) => {
  if (!laneRoot) return null;
  const target = path.resolve(filePath);
  const control = path.join(path.resolve(laneRoot), 'coding', 'sandboxes');
  const folded = target.toLowerCase();
  const scope = control.toLowerCase();
  if (folded === scope || scope.startsWith(folded.endsWith(path.sep) ? folded : folded + path.sep)) return REFUSAL;
  if (!folded.startsWith(scope + path.sep)) return null;
  const parts = path.relative(control, target).split(path.sep);
  let upperLength = 0;
  if (/^[a-f0-9]{12}$/i.test(parts[0])) {
    if (parts[1]?.toLowerCase() === 'upper' && parts.length > 2) upperLength = 2;
    if (parts[1]?.toLowerCase() === 'generations' && GENERATION.test(parts[2] || '')
      && parts[3]?.toLowerCase() === 'upper' && parts.length > 4) upperLength = 4;
  }
  if (!upperLength) return REFUSAL;
  const upper = path.join(control, ...parts.slice(0, upperLength));
  const stat = await fs.lstat(upper).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  return stat?.isDirectory() && !stat.isSymbolicLink() ? null : REFUSAL;
};
