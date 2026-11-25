// Tripwire — the standing decoy watch. Plants decoy wallet and key files
// where no real app lives, watches them, and answers a read: name the reader
// when it is caught holding the file, freeze it (SIGSTOP — same user, no
// root), and hand one finding per incident to the filer.
//
// OFF until the install owner turns it on: it writes files into the home
// folder, and that is the operator's choice. Linux only for now.
//
// State is one JSON document (`<settings>/tripwire.json`): the switch, the
// record of every planted file, and every process this watch froze — so a
// restart can still release them.

import fs from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { getSettingsDir } from '../../data-root.js';
import { writeJsonAtomic } from '../../user-realm.js';
import { createWriteChain } from '../../write-chain.js';
import { createLogger } from '../../logger.js';
import { DECOYS } from './decoy-catalog.js';
import { syncDecoys, removeAllDecoys, decoyPaths } from './decoy-store.js';
import { createDecoyWatch, findInotifywait, probeAtime } from './decoy-watch.js';
import { holdersOf, describeProcess, ancestorsOf, recentProcesses } from './reader-finder.js';
import { readerStanding, mayFreeze, incidentFinding } from './tripwire-findings.js';

const log = createLogger('Tripwire');

// NEUMA_TRIPWIRE_PATH and NEUMA_TRIPWIRE_HOME are the test doors: a suite never
// plants a decoy in the operator's real home folder.
const defaultStatePath = () => process.env.NEUMA_TRIPWIRE_PATH || join(getSettingsDir(), 'tripwire.json');
const EMPTY = Object.freeze({ enabled: false, decoys: {}, frozen: [], lastIncident: null });
const SAME_START_MS = 1500;

/**
 * @param {{statePath?: Function|string, home?: string, platform?: string, pollMs?: number, windowMs?: number,
 *   inotifywait?: ?string, file?: Function}} [opts]
 *   inotifywait — undefined: look for the system's; null: use the atime eye
 *   file — async (finding) => void, lands a finding in the ledger(s)
 */
export const createTripwire = ({
  statePath = defaultStatePath, home = process.env.NEUMA_TRIPWIRE_HOME || os.homedir(), platform = process.platform,
  pollMs = 1000, windowMs = 3000, inotifywait, file = async () => {},
} = {}) => {
  const target = () => (typeof statePath === 'function' ? statePath() : statePath);
  const serialize = createWriteChain();
  let filer = file;
  let watch = null;
  let mode = 'off';
  let incident = null;
  let inotifyDown = false;
  let settling = Promise.resolve();

  // impure — a missing state file is the default state.
  const load = async () => {
    const raw = await fs.readFile(target(), 'utf8').catch((err) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  };
  const mutate = (fn) => serialize(async () => {
    const state = await load();
    const result = await fn(state);
    await writeJsonAtomic(target(), state);
    return result;
  });

  const stopWatch = () => {
    watch?.stop();
    watch = null;
    mode = 'off';
  };

  // impure — freeze one caught reader and prove it took.
  const freeze = async (proc, at) => {
    try {
      process.kill(proc.pid, 'SIGSTOP');
    } catch (err) {
      log.warn('a decoy reader could not be frozen', { pid: proc.pid, error: err.message });
      return false;
    }
    await mutate((state) => {
      state.frozen.push({ pid: proc.pid, startedAtMs: proc.startedAtMs, exe: proc.exe, comm: proc.comm, script: proc.script, at: new Date(at).toISOString() });
    });
    return true;
  };

  // impure — every process holding a decoy open right now joins the incident.
  const catchReaders = async (open, paths, at) => {
    const selfAncestors = await ancestorsOf(process.pid);
    for (const holder of await holdersOf(paths)) {
      if (open.readers.some((r) => r.pid === holder.pid)) continue;
      const proc = await describeProcess(holder.pid);
      if (!proc) continue;
      const standing = readerStanding(proc, {
        selfPid: process.pid, selfAncestors, procAncestors: await ancestorsOf(holder.pid),
      });
      if (standing === 'self') continue;
      const frozen = mayFreeze(standing) ? await freeze(proc, at) : false;
      open.readers.push({ ...proc, standing, frozen });
    }
  };

  // impure — close the incident: file it, record it, repair what was removed.
  const flush = async () => {
    const closing = incident;
    incident = null;
    const caught = closing.readers.some((r) => r.standing !== 'indexer');
    const candidates = caught ? [] : await recentProcesses({ atMs: closing.startedAt, skip: new Set([process.pid]) });
    const finding = incidentFinding({ ...closing, candidates });
    await mutate((state) => {
      state.lastIncident = { at: new Date(closing.startedAt).toISOString(), title: finding.title, severity: finding.severity };
    });
    log.warn('a decoy was touched', { title: finding.title, readers: closing.readers.length, severity: finding.severity });
    await filer(finding).catch((err) => log.error('the decoy finding did not reach the ledger', { error: err.message }));
    if (closing.hits.some((h) => h.kind === 'removed')) await arm();
  };

  const onHit = (hit, paths) => {
    const decoyId = paths.get(hit.path);
    if (!decoyId) return;
    if (!incident) {
      incident = { startedAt: hit.at, hits: [], readers: [] };
      const timer = setTimeout(() => {
        settling = settling.then(flush).catch((err) => log.error('decoy incident failed', { error: err.message }));
      }, windowMs);
      timer.unref?.();
    }
    const open = incident;
    open.hits.push({ ...hit, decoyId });
    if (hit.kind === 'read') {
      settling = settling.then(() => catchReaders(open, paths.keys(), hit.at))
        .catch((err) => log.error('the decoy reader scan failed', { error: err.message }));
    }
  };

  // impure — plant or repair, then stand the watch.
  const arm = async () => {
    stopWatch();
    const records = await mutate(async (state) => {
      state.decoys = await syncDecoys(home, state.decoys);
      return state.decoys;
    });
    const paths = decoyPaths(records);
    if (paths.size === 0) {
      mode = 'idle';
      return;
    }
    const bin = inotifyDown ? null : (inotifywait === undefined ? await findInotifywait() : inotifywait);
    if (!bin && !(await probeAtime([...paths.keys()][0]))) {
      mode = 'blind';
      log.warn('the decoy watch cannot see reads here: no inotifywait, and this filesystem does not record access times');
      return;
    }
    watch = createDecoyWatch({
      paths: [...paths.keys()], pollMs, inotifywait: bin,
      onHit: (hit) => onHit(hit, paths),
      // inotifywait died: stand the watch again on the atime eye.
      onDown: (why) => {
        log.error('the decoy watch went down', { why });
        inotifyDown = true;
        arm().catch((err) => log.error('the decoy watch did not come back', { error: err.message }));
      },
    });
    mode = watch.mode;
    await watch.ready;
  };

  // impure — let one frozen process run again, if it is still the same one.
  const thaw = async (entry) => {
    const proc = await describeProcess(entry.pid);
    if (!proc || Math.abs(proc.startedAtMs - entry.startedAtMs) > SAME_START_MS) return false;
    process.kill(entry.pid, 'SIGCONT');
    return true;
  };

  return {
    supported: platform === 'linux',

    /** Set where findings land (the scheduler wires the houses' ledgers). */
    setFiler(fn) { filer = fn; },

    /** Stand the watch if the operator turned it on. impure. */
    async start() {
      if (platform !== 'linux') return;
      if ((await load()).enabled) await arm();
    },

    /** Turn the decoys on (plant + watch) or off (release, remove). impure. */
    async setEnabled(on) {
      if (platform !== 'linux') throw new Error('The decoy watch runs on Linux only for now.');
      if (on) {
        await mutate((state) => { state.enabled = true; });
        await arm();
        return;
      }
      stopWatch();
      await mutate(async (state) => {
        for (const entry of state.frozen) await thaw(entry).catch(() => false);
        await removeAllDecoys(state.decoys);
        Object.assign(state, { enabled: false, decoys: {}, frozen: [] });
      });
    },

    /** Release one process this watch froze. impure. @returns {Promise<boolean>} */
    release(pid) {
      return mutate(async (state) => {
        const entry = state.frozen.find((f) => f.pid === pid);
        if (!entry) return false;
        const resumed = await thaw(entry);
        state.frozen = state.frozen.filter((f) => f !== entry);
        return resumed;
      });
    },

    /** What the desk shows. impure. */
    async status() {
      const state = await load();
      const alive = await Promise.all(state.frozen.map(async (f) => {
        const proc = await describeProcess(f.pid);
        return proc && Math.abs(proc.startedAtMs - f.startedAtMs) <= SAME_START_MS && proc.state === 'T';
      }));
      return {
        supported: platform === 'linux',
        enabled: state.enabled,
        mode: state.enabled ? mode : 'off',
        decoys: DECOYS.map((d) => {
          const record = state.decoys[d.id];
          return { id: d.id, name: d.name, status: record?.status || 'none', reason: record?.reason || null, files: (record?.files || []).map((f) => f.path) };
        }),
        frozen: state.frozen.filter((_, i) => alive[i]),
        lastIncident: state.lastIncident,
      };
    },

    /** Everything in flight has landed (tests, shutdown). impure. */
    settled: () => settling,

    stop: stopWatch,
  };
};

export const tripwire = createTripwire();
