/**
 * ComfyUI wire client — the backend's typed line to the engine's HTTP/WS API.
 *
 * The primitives only (B-5): submit/history/queue/jobs/cancel/interrupt/upload
 * and one event socket. NO completion logic lives here — job-lane.js owns the
 * completion doctrine and the single-flight map; this file is the transport.
 * Zero new npm deps: Node `fetch` + `FormData` for HTTP (the multipart upload
 * round-trip was proven with native FormData in the spike), the already-present
 * `ws` package for the socket.
 *
 * Every call takes a resolved config (`resolveComfyConfig`) so host/port are one
 * truth with the supervisor. Loopback by construction (the config clamps it).
 */
import { WebSocket } from 'ws';
import { createLogger } from '../logger.js';

const log = createLogger('ImageForge.Client');

const HTTP_TIMEOUT_MS = 10_000;

const base = (cfg) => `http://${cfg.host}:${cfg.port}`;

// impure — a JSON POST/GET with a bounded timeout and an honest error.
const httpJson = async (url, init = {}) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(init.timeoutMs ?? HTTP_TIMEOUT_MS), ...init });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
};

/**
 * Enqueue a graph. NEUMA mints BOTH ids so the caller correlates journal →
 * job → outputs with no response round-trip: `promptId` is the job key,
 * `clientId` routes this job's WS events to our one held socket. Returns the
 * engine's ack (echoing prompt_id + number) or a machine-readable error with
 * the POST /prompt validation taxonomy intact for FR-12 mapping. Impure.
 * @param {object} cfg
 * @param {{prompt: object, promptId: string, clientId: string}} job
 */
export const submitPrompt = async (cfg, { prompt, promptId, clientId }) => {
  const { ok, status, body } = await httpJson(`${base(cfg)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, prompt_id: promptId, client_id: clientId }),
  });
  if (!ok) {
    // The engine's structured validation error (node_errors / type) rides
    // through untouched — job-lane maps it to {status:'error', detail}.
    return { ok: false, status, error: body?.error ?? body, nodeErrors: body?.node_errors ?? null };
  }
  return { ok: true, promptId: body?.prompt_id ?? promptId, number: body?.number ?? null, nodeErrors: body?.node_errors ?? null };
};

/**
 * The completion VERDICT (not the trigger): history is written BEFORE the
 * terminal WS event (write-then-notify, spike item 7 confirmed N=8). Returns
 * the entry or null when history has no record (wiped on restart — the journal
 * is the durable record, not this). Impure.
 * @param {object} cfg
 * @param {string} promptId
 */
export const getHistory = async (cfg, promptId) => {
  const { ok, body } = await httpJson(`${base(cfg)}/history/${promptId}`);
  if (!ok || !body) return null;
  const entry = body[promptId];
  if (!entry) return null;
  return {
    completed: entry.status?.completed ?? false,
    statusStr: entry.status?.status_str ?? null,
    messages: entry.status?.messages ?? [],
    outputs: entry.outputs ?? {},
  };
};

/** The engine's queue depth — running/pending, the reap + status-language source. Impure. */
export const getQueue = async (cfg) => {
  const { ok, body } = await httpJson(`${base(cfg)}/queue`);
  if (!ok || !body) return { running: 0, pending: 0 };
  return { running: body.queue_running?.length ?? 0, pending: body.queue_pending?.length ?? 0 };
};

/**
 * The native jobs surface (newest API, highest drift risk — spike item 9).
 * status vocabulary includes `cancelled`; GET keys id/status/priority/
 * create_time/outputs_count. Returns null when the job is unknown. Impure.
 */
export const getJob = async (cfg, jobId) => {
  const { ok, body } = await httpJson(`${base(cfg)}/api/jobs/${jobId}`);
  if (!ok || !body) return null;
  return body;
};

/**
 * Barge-in: cancel a job atomically under the queue mutex — cannot land on a
 * successor prompt, state-agnostic (running ⇒ interrupt, pending ⇒ dequeue),
 * idempotent (repeat cancel ALSO returns `{cancelled:true}` — spike item 9
 * correction). Impure.
 */
export const cancelJob = async (cfg, jobId) => {
  const { ok, status, body } = await httpJson(`${base(cfg)}/api/jobs/${jobId}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  return { ok, status, cancelled: body?.cancelled === true };
};

/**
 * Fallback interrupt if the jobs API ever drifts: interrupts the CURRENTLY
 * running prompt (no id — engine limitation), so job-lane only reaches for it
 * when our job is the one running. Impure.
 */
export const interruptCurrent = async (cfg) => {
  const { ok, status } = await httpJson(`${base(cfg)}/interrupt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  return { ok, status };
};

/**
 * Upload an input image for img2img (native FormData multipart — spike item 12).
 * The engine dedupes/suffixes and returns the AUTHORITATIVE `name` to reference
 * in a LoadImage node. Impure.
 * @param {object} cfg
 * @param {{bytes: Buffer|Uint8Array, filename: string, mime: string}} file
 * @returns {Promise<{name: string, subfolder: string, type: string}>}
 */
export const uploadImage = async (cfg, { bytes, filename, mime }) => {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), filename);
  form.append('overwrite', 'false');
  const res = await fetch(`${base(cfg)}/upload/image`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`upload/image failed (${res.status})`);
  const body = await res.json();
  return { name: body.name, subfolder: body.subfolder ?? '', type: body.type ?? 'input' };
};

/**
 * Open ONE event socket under our minted clientId. Every per-job WS event
 * routes only to the submitting client_id, so this is held open for the life
 * of the lane; job-lane demultiplexes by prompt_id. Binary frames (preview)
 * are tolerated and dropped — the default preview method is `none` anyway, but
 * the client must never choke on a binary frame. Impure.
 * @param {object} cfg
 * @param {string} clientId
 * @param {{onEvent: (ev: object) => void, onOpen?: () => void, onClose?: () => void, onError?: (e: Error) => void}} handlers
 * @returns {WebSocket}
 */
export const openEventSocket = (cfg, clientId, handlers) => {
  const ws = new WebSocket(`ws://${cfg.host}:${cfg.port}/ws?clientId=${clientId}`);
  ws.on('open', () => handlers.onOpen?.());
  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // preview frame — tolerated, dropped
    let ev;
    try { ev = JSON.parse(data.toString()); } catch { return; }
    if (ev && typeof ev === 'object') handlers.onEvent(ev);
  });
  ws.on('close', () => handlers.onClose?.());
  ws.on('error', (err) => {
    log.warn('event socket error', { err: err.message });
    handlers.onError?.(err);
  });
  return ws;
};
