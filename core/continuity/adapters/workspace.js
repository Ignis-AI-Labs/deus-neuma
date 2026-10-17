// WorkspaceAdapter — the StoreAdapter over a neuma's sovereign, encrypted
// NeumaWorkspace. Plug this into the continuity engine and a neuma gets the
// SAME four memory layers (episodic/semantic/procedural/working) over its own
// AES-256-GCM-encrypted store. The plain-directory adapter (fsdir, used by
// Claude and the portable skill) and this one share the engine; only the
// substrate differs.
//
// Layout (per neuma):
//   <workspace>/continuity/<layer>.jsonl
// Each LINE is one AES-256-GCM envelope — append-only, per-line encrypted at
// rest, ordered by the workspace's existing serialized `_appendLine` queue
// (the #14 chronological-order fix carries through).
//
// This adapter delegates all persistence + crypto to NeumaWorkspace
// (appendContinuityEntry, readContinuityLog) so encryption, paths, and queueing
// stay owned by the workspace. The adapter only implements the StoreAdapter
// contract (append/read/list/history/expire) by composing those primitives with
// the pure foldLog.

import { LAYERS, isIso } from '../record.js';
import { assertLayer, foldLog } from '../store-adapter.js';

export class WorkspaceAdapter {
  /**
   * @param {string} neumaId - the sovereign id of the neuma whose store this is
   * @param {{workspace: Object}} opts - the workspace holding this neuma's
   *   store (the neuma-workspace singleton in production, a realm-pinned one
   *   in tests). EXPLICIT since CQ-036 (#395): the old singleton default was
   *   the one static edge that closed a five-module cycle through the
   *   workspace system — and an adapter binding a being to a store should
   *   name its store, not reach for a hidden global.
   */
  constructor(neumaId, { workspace } = {}) {
    if (typeof neumaId !== 'string' || !neumaId) {
      throw new Error('WorkspaceAdapter: neumaId required');
    }
    if (!workspace || typeof workspace.appendContinuityEntry !== 'function') {
      throw new Error('WorkspaceAdapter: a workspace is required — pass the neuma-workspace singleton or a test realm');
    }
    this.neumaId = neumaId;
    this.workspace = workspace;
  }

  /**
   * Append a record (encrypted as a per-line envelope) to its layer log.
   * Never overwrites. Returns the record unchanged.
   * @param {Object} record
   * @returns {Promise<Object>}
   */
  async append(record) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
      throw new Error('WorkspaceAdapter.append: a record with an id is required');
    }
    assertLayer(record.layer);
    await this.workspace.appendContinuityEntry(this.neumaId, record.layer, record);
    return record;
  }

  /**
   * Append an expiry marker that stamps validTo on a record without deleting it.
   * @param {string} layer
   * @param {string} id
   * @param {{at?:string, supersededBy?:string}} [opts]
   * @returns {Promise<Object>}
   */
  async expire(layer, id, opts = {}) {
    assertLayer(layer);
    if (typeof id !== 'string' || !id) throw new Error('WorkspaceAdapter.expire: id required');
    const at = opts.at || new Date().toISOString();
    if (!isIso(at)) throw new Error(`WorkspaceAdapter.expire: at must be an ISO timestamp, got ${String(at)}`);
    const marker = { op: 'expire', targetId: id, at, supersededBy: opts.supersededBy ?? null };
    await this.workspace.appendContinuityEntry(this.neumaId, layer, marker);
    return marker;
  }

  /**
   * Current folded view of one record id (null when absent or, unless asOf says
   * otherwise, currently expired).
   * @param {string} layer
   * @param {string} id
   * @param {{asOf?:string, includeRetired?:boolean}} [opts]
   * @returns {Promise<Object|null>}
   */
  async read(layer, id, opts = {}) {
    const view = foldLog(await this.workspace.readContinuityLog(this.neumaId, layer), opts);
    return view.find((r) => r.id === id) || null;
  }

  /**
   * Current folded view of a layer, optionally scoped to a space. Pass
   * includeRetired for the full set including expired records.
   * @param {string} layer
   * @param {{space?:string, asOf?:string, includeRetired?:boolean}} [opts]
   * @returns {Promise<Object[]>}
   */
  async list(layer, opts = {}) {
    let view = foldLog(await this.workspace.readContinuityLog(this.neumaId, layer), opts);
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
    const log = await this.workspace.readContinuityLog(this.neumaId, layer);
    return log.filter((e) => e.id === id || (e.op === 'expire' && e.targetId === id));
  }

  /** All layers this adapter manages (the four). */
  layers() {
    return [...LAYERS];
  }
}
