// impure - bounded asynchronous discovery for a selective directory watch.
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

/** Pure - ignored ancestry lookup costs path depth, not ignored-tree size. */
export const isIgnoredWatchDir = (dir, ignored) => {
  if (!ignored?.size) return false;
  for (let at = dir; ; at = path.dirname(at)) {
    if (ignored.has(at)) return true;
    if (path.dirname(at) === at) return false;
  }
};

/** impure - prune in bounded slices, never revive a root closed during a yield. */
export const pruneIgnoredWatches = async ({ dirs, isIgnored, isLive }) => {
  let count = 0;
  for (const [dir, watch] of [...dirs]) {
    if (!isLive()) return;
    if (isIgnored(dir)) { watch.close(); dirs.delete(dir); }
    if (++count % 32 === 0) await yieldToLoop();
  }
};

/** Create one cancellable, serialized breadth-first walker for a root. */
export const createFilesWatchWalk = ({
  dirs, cap, isLive, isIgnored, isNoise, watchDir, onComplete, onError,
}) => {
  const pending = new Set();
  let running = false;
  let closed = false;
  const live = () => !closed && isLive();

  const walk = async (start) => {
    const queue = [start];
    let opened = false;
    let capped = false;
    let entriesSeen = 0;
    for (let at = 0; at < queue.length && live(); at += 1) {
      const dir = queue[at];
      if (isIgnored(dir)) continue;
      if (!dirs.has(dir)) {
        if (dirs.size >= cap) { capped = true; break; }
        if (!watchDir(dir)) continue;
        opened = true;
      }
      if (path.basename(dir) === '.git') continue;
      try {
        const directory = await fs.opendir(dir);
        for await (const entry of directory) {
          if (!live() || isIgnored(dir)) break;
          if (++entriesSeen % 32 === 0) await yieldToLoop();
          if (!live()) break;
          if (!entry.isDirectory() || isNoise(entry.name)) continue;
          const child = path.join(dir, entry.name);
          if (isIgnored(child)) continue;
          // Bound both descriptors and traversal memory, including wide trees.
          if (queue.length < cap) queue.push(child);
          else capped = true;
        }
      } catch (error) {
        if (live() && !['ENOENT', 'ENOTDIR'].includes(error.code)) onError(error);
      }
    }
    if (live()) onComplete({ opened, capped });
  };

  const drain = async () => {
    running = true;
    try {
      while (pending.size && live()) {
        const start = pending.values().next().value;
        pending.delete(start);
        await walk(start);
      }
    } catch (error) {
      if (live()) onError(error);
    } finally {
      running = false;
    }
  };

  return Object.freeze({
    enqueue(start) {
      if (!live()) return;
      if (pending.size < cap) pending.add(start);
      if (!running) void drain();
    },
    close() { closed = true; pending.clear(); },
  });
};
