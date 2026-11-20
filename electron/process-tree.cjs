// utilityProcess has no detached option, so POSIX descendants are found explicitly instead of
// assuming the backend leads a process group. Windows keeps taskkill /T in the callers.
const fs = require('node:fs');

const processRow = (text) => {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const pid = Number(text.slice(0, open).trim());
  const fields = text.slice(close + 2).trim().split(/\s+/);
  const parentPid = Number(fields[1]);
  return Number.isInteger(pid) && Number.isInteger(parentPid) ? { pid, parentPid } : null;
};

const descendantsOf = (rows, rootPid) => {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.parentPid)) children.set(row.parentPid, []);
    children.get(row.parentPid).push(row.pid);
  }
  const found = [];
  const seen = new Set([rootPid]);
  const queue = [...(children.get(rootPid) || [])];
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    found.push(pid);
    queue.push(...(children.get(pid) || []));
  }
  return found;
};

const readProcessRows = () => fs.readdirSync('/proc')
  .filter((entry) => /^\d+$/.test(entry))
  .map((pid) => {
    try { return processRow(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return null; }
  })
  .filter(Boolean);

// impure — signal descendants deepest-first, then the root; already-exited processes are expected.
const stopPosixTree = (pid, force = false) => {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  for (const descendant of descendantsOf(readProcessRows(), pid).reverse()) {
    try { process.kill(descendant, signal); } catch { /* already gone */ }
  }
  try { process.kill(pid, signal); } catch { /* already gone */ }
};

module.exports = { processRow, descendantsOf, stopPosixTree };
