import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const outside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
};

// impure — every parent below the trusted root is a real directory on disk.
export const containedDirectory = async (root, directory) => {
  const absoluteRoot = path.resolve(root);
  const absoluteDirectory = path.resolve(directory);
  if (outside(absoluteRoot, absoluteDirectory)) throw new Error('report directory escapes its workspace');
  const realRoot = await fs.realpath(absoluteRoot);
  const relative = path.relative(absoluteRoot, absoluteDirectory);
  let current = absoluteRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let info = await fs.lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink() || (info && !info.isDirectory())) throw new Error('report directory must not contain symbolic links');
    if (!info) await fs.mkdir(current);
  }
  const realDirectory = await fs.realpath(absoluteDirectory);
  if (outside(realRoot, realDirectory)) throw new Error('report directory escapes its workspace through a symbolic link');
  return absoluteDirectory;
};

// impure — a basename in a contained directory; an existing leaf is a regular file, never a link.
export const containedFile = async (root, directory, name) => {
  if (typeof name !== 'string' || !name || path.basename(name) !== name || name === '.' || name === '..') {
    throw new Error('report name must be one filename');
  }
  const parent = await containedDirectory(root, directory);
  const file = path.join(parent, name);
  const info = await fs.lstat(file).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info && (info.isSymbolicLink() || !info.isFile())) throw new Error('report target must be a regular file, never a symbolic link');
  return file;
};

// impure — write one contained UTF-8 file without following a planted leaf link.
export const writeContainedFile = async ({ root, directory, name, body, append = false, exclusive = false }) => {
  const file = await containedFile(root, directory, name);
  const operation = append ? constants.O_APPEND : exclusive ? constants.O_EXCL : constants.O_TRUNC;
  const flags = constants.O_WRONLY | constants.O_CREAT | NO_FOLLOW | operation;
  const handle = await fs.open(file, flags, 0o600);
  try {
    await handle.writeFile(String(body), 'utf8');
  } finally {
    await handle.close();
  }
  return file;
};
