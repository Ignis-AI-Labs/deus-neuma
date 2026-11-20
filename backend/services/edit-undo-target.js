import fs from 'node:fs';
import path from 'node:path';
import { checkPathAccess, laneStateWriteReason } from './sandbox-path-policy.js';

const nearestReal = (target) => {
  const tail = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
};

const contained = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

// impure — resolves disk links and applies the same path law as the being tools.
export const resolveUndoTarget = (projectRoot, candidate) => {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw new Error('Undo refused: the snapshot target is not an absolute path');
  }
  const root = fs.realpathSync(projectRoot);
  const target = nearestReal(candidate);
  if (!contained(root, target)) throw new Error('Undo refused: the snapshot target escapes the project root');
  const first = path.relative(root, target).split(path.sep)[0]?.toLowerCase();
  if (first === '.git' || first === '.neuma') throw new Error('Undo refused: repository and undo metadata are not restorable targets');
  const access = checkPathAccess(target, [root], { requireRoot: true });
  if (!access.allowed) throw new Error(`Undo refused: ${access.reason}`);
  const wall = laneStateWriteReason(target);
  if (wall) throw new Error(`Undo refused: ${wall}`);
  if (fs.lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('Undo refused: the snapshot target is a symbolic link');
  }
  return target;
};
