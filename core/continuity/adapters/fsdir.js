// fsdir adapter — the StoreAdapter over a plain directory of records.
//
// This is the adapter that makes the continuity engine run for ANY AI with a
// filesystem and nothing else: no database, no encryption keys, no neuma stack.
// Claude's own /memory is exactly this shape. The neuma path will plug a
// different adapter (encrypted NeumaWorkspace) into the SAME core later.
//
// Layout (one append-only log per layer):
//   <root>/episodic.jsonl
//   <root>/semantic.jsonl
//   <root>/procedural.jsonl
//   <root>/working.jsonl
//
// Each line is one JSON entry: a record, or an expiry marker. Appending never
// rewrites a line — retire = append. Reads fold the log (store-adapter.foldLog)
// into the current view while history() exposes every version.
//
// Concurrency: appends to one file are serialized through a per-file promise
// queue. On ext4 O_APPEND already keeps each line intact, but it does NOT
// preserve ORDER under concurrency (proven in WORKSPACE-CONCURRENCY-001 / #14);
// a continuity log is chronological, so order is load-bearing. The queue also
// guarantees interleave-safety on filesystems where O_APPEND is not atomic (NFS).

import fs from 'fs/promises';
import path from 'path';
import { LAYERS, isIso } from '../record.js';
import { assertLayer, foldLog } from '../store-adapter.js';

export class FsDirAdapter {
  /**
   * @param {string} root - directory the logs live in (created on demand)
   * @param {{onTornLine?: (line:string, err:Error, layer:string)=>void}} [opts]
   *   onTornLine is called for every unparseable log line. PRODUCTION callers
   *   should inject this to route corruption into their structured logger; the
   *   default falls back to console.warn (core/ stays substrate-agnostic and must
   *   not import a platform logger). Either way a torn line is NEVER silently
   *   swallowed (Rule 3) — a corrupted expiry/supersession marker would skew the
   *   current view, so it is always surfaced + counted (tornLineCount).
   */
  constructor(root, opts = {}) {
    if (typeof root !== 'string' || !root) throw new Error('FsDirAdapter: root path required');
    this.root = root;
    this._queues = new Map();        // filePath -> tail promise (per-file append serializer)
    this._ensuredDirs = new Set();   // dirs known to exist (skip redundant mkdir syscalls)
    this._onTornLine = typeof opts.onTornLine === 'function' ? opts.onTornLine : null;
    this.tornLineCount = 0;          // observable corruption counter (surfaced, not hidden)
  }

  _file(layer) {
    assertLayer(layer);
    return path.join(this.root, `${layer}.jsonl`);
  }

  // impure — serialized per-file append; mutates _queues and writes to disk.
  // mkdir lives INSIDE the serialized chain so a slow mkdir can't let a later
  // append win the race and reorder the log (the #14 journal-ordering fix).
  async _append(filePath, line) {
    const dir = path.dirname(filePath);
    const prev = this._queues.get(filePath) || Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      // mkdir stays INSIDE the serialized chain (the #14 ordering fix) but runs
      // only until the dir is known to exist — one syscall, not one per append.
      if (!this._ensuredDirs.has(dir)) {
        await fs.mkdir(dir, { recursive: true });
        this._ensuredDirs.add(dir);
      }
      return fs.appendFile(filePath, line);
    });
    this._queues.set(filePath, run);
    run.catch(() => {}).finally(() => {
      if (this._queues.get(filePath) === run) this._queues.delete(filePath);
    });
    return run;
  }

  // impure — read + parse the raw append log for a layer (empty if absent).
  async _readLog(layer) {
    const filePath = this._file(layer);
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch (err) {
        // A torn/garbage line never takes down recall — skip it, keep the rest.
        // (O_APPEND keeps whole lines intact; this guards manual edits / partial
        // writes.) But it is SURFACED, not swallowed (Rule 3): a corrupted expiry
        // or supersession marker would silently skew the folded current view.
        this.tornLineCount++;
        if (this._onTornLine) this._onTornLine(trimmed, err, layer);
        else console.warn(`[continuity] skipped a torn line in ${layer}.jsonl (possible corruption): ${err.message}`);
      }
    }
    return out;
  }

  /**
   * Append a record (produced by makeRecord) to its layer log. Returns the
   * record unchanged. Never overwrites an existing entry.
   * @param {Object} record
   * @returns {Promise<Object>}
   */
  async append(record) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
      throw new Error('FsDirAdapter.append: a record with an id is required');
    }
    assertLayer(record.layer);
    await this._append(this._file(record.layer), JSON.stringify(record) + '\n');
    return record;
  }

  /**
   * Append an expiry marker that stamps validTo on a record without deleting it.
   * @param {string} layer
   * @param {string} id - record to expire
   * @param {{at?:string, supersededBy?:string}} [opts]
   * @returns {Promise<Object>} the expiry marker written
   */
  async expire(layer, id, opts = {}) {
    assertLayer(layer);
    if (typeof id !== 'string' || !id) throw new Error('FsDirAdapter.expire: id required');
    const at = opts.at || new Date().toISOString();
    // expire is the one path whose whole purpose is to retire a record — a
    // malformed `at` must fail loud here, not persist a marker the fold drops.
    if (!isIso(at)) throw new Error(`FsDirAdapter.expire: at must be an ISO timestamp, got ${String(at)}`);
    const marker = {
      op: 'expire',
      targetId: id,
      at,
      supersededBy: opts.supersededBy ?? null,
    };
    await this._append(this._file(layer), JSON.stringify(marker) + '\n');
    return marker;
  }

  /**
   * Current folded view of one record id (null if absent or, unless asOf says
   * otherwise, currently expired).
   * @param {string} layer
   * @param {string} id
   * @param {{asOf?:string, includeRetired?:boolean}} [opts]
   * @returns {Promise<Object|null>}
   */
  async read(layer, id, opts = {}) {
    const view = foldLog(await this._readLog(layer), opts);
    return view.find((r) => r.id === id) || null;
  }

  /**
   * Current folded view of a layer, optionally scoped to a space. Pass
   * includeRetired to get the full set including expired records.
   * @param {string} layer
   * @param {{space?:string, asOf?:string, includeRetired?:boolean}} [opts]
   * @returns {Promise<Object[]>}
   */
  async list(layer, opts = {}) {
    let view = foldLog(await this._readLog(layer), opts);
    if (typeof opts.space === 'string' && opts.space) {
      view = view.filter((r) => r.space === opts.space);
    }
    return view;
  }

  /**
   * Every version + expiry ever appended for one id, in append order. The raw
   * audit trail — supersede-not-delete made inspectable.
   * @param {string} layer
   * @param {string} id
   * @returns {Promise<Object[]>}
   */
  async history(layer, id) {
    const log = await this._readLog(layer);
    return log.filter((e) => e.id === id || (e.op === 'expire' && e.targetId === id));
  }

  /** All layers this adapter manages (the four). */
  layers() {
    return [...LAYERS];
  }
}
