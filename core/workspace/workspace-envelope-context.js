import fs from 'node:fs/promises';
import path from 'node:path';

const HARD_LINK_TEMP = /^(.+)\.\d+\.[a-f0-9]{16}\.tmp$/;

export const logicalWorkspaceFile = (filePath) => {
  const match = path.basename(filePath).match(HARD_LINK_TEMP);
  return match ? path.join(path.dirname(filePath), match[1].endsWith('.json') ? match[1] : `${match[1]}.json`) : filePath;
};

const companionFor = (filePath) => `${logicalWorkspaceFile(filePath)}.seq`;

const contextFor = (workspace, filePath, seq) => {
  const logical = logicalWorkspaceFile(filePath);
  const laneId = workspace._neumaIdFromPath(logical);
  if (!laneId) throw new Error('workspace envelope AAD requires a lane-internal file');
  const relative = path.relative(workspace._path(laneId), logical);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('workspace envelope AAD file is outside its lane');
  const file = relative.split(path.sep).join('/');
  return { logical, aad: { purpose: file.split('/')[0], laneId, file, seq } };
};

const readGeneration = async (filePath) => {
  try {
    const value = JSON.parse(await fs.readFile(companionFor(filePath), 'utf8'));
    if (!Number.isSafeInteger(value.seq) || value.seq < 0) throw new Error('invalid workspace generation');
    return value.seq;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
};

// impure — the companion advances only after the data file lands; a newer data file heals a crash gap.
const writeGeneration = async (filePath, seq) => {
  const companion = companionFor(filePath);
  const temp = `${companion}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ seq }), { mode: 0o600, flag: 'wx' });
  await fs.rename(temp, companion);
};

export const wholeFileWriteContext = async (workspace, filePath) => {
  const immutable = HARD_LINK_TEMP.test(path.basename(filePath));
  const logical = logicalWorkspaceFile(filePath);
  let exists = true;
  try { await fs.access(logical); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
  const previous = await readGeneration(logical);
  return { ...contextFor(workspace, logical, immutable ? 0 : previous + (exists ? 1 : 0)), immutable };
};

export const wholeFileReadContext = (workspace, filePath, envelope) => {
  if (!envelope?.aad) return null;
  return contextFor(workspace, filePath, envelope.aad.seq).aad;
};

// A first write is generation 0, which is also what a missing companion reads as — so it writes none.
// Write-once stores (dna/history, vault archives) keep one file per record instead of a record and a
// companion that says nothing.
export const commitWholeFileGeneration = async (filePath, aad) => {
  if (aad.seq === 0 || HARD_LINK_TEMP.test(path.basename(filePath))) return;
  await writeGeneration(filePath, aad.seq);
};

export const acceptWholeFileGeneration = async (filePath, envelope) => {
  if (!envelope?.aad) return;
  const current = await readGeneration(filePath);
  if (envelope.aad.seq < current) {
    throw Object.assign(new Error('workspace envelope is older than its recorded generation'), { code: 'ENVELOPE_ROLLBACK' });
  }
  if (envelope.aad.seq > current) await writeGeneration(filePath, envelope.aad.seq);
};
