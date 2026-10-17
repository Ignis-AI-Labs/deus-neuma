/**
 * FREE A LOCAL MODEL SERVER — so a person can move from one server to another
 * (Design note, 2026-10-14: […]).
 *
 * Two servers rarely fit one GPU beside each other's weights. Freeing a server
 * returns its memory in each server's own words:
 *   - LM Studio: every loaded model is unloaded (/api/v1/models/unload); the
 *     app stays open and loads again on the next turn that asks for one.
 *   - Ollama: every running model is told to leave now (keep_alive 0).
 *   - llama.cpp: only the server this platform started is stopped — and never
 *     mid-answer. One started outside the platform is not ours to kill; the
 *     reply says where to stop it.
 *
 * Loopback only: a server on another computer is never reached from here.
 */
import { activeLaunchConfig, stopSupervised, supervisorStatus } from './llama-server-supervisor.js';
import { substrateBusy } from './substrate-lifecycle.js';

const TIMEOUT_MS = 30_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const baseOf = (endpoint) => String(endpoint || '').replace(/\/+$/, '').replace(/\/v1$/, '');

/** Is this a server on this machine? Pure. */
export const isLoopbackEndpoint = (endpoint) => {
  try { return LOOPBACK.has(new URL(baseOf(endpoint)).hostname); } catch { return false; }
};

// impure — JSON in, JSON out, null on any failure
const call = async (url, body = null) => {
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? await res.json().catch(() => ({})) : null;
  } catch {
    return null;
  }
};

const done = (freed, line) => Object.freeze({ ok: true, freed, line });
const refused = (code, line) => Object.freeze({ ok: false, code, line });

// impure — LM Studio: unload every loaded instance
const freeLmStudio = async (base) => {
  const listed = await call(`${base}/api/v1/models`);
  if (!Array.isArray(listed?.models)) return refused('unreadable', 'LM Studio did not answer its model list.');
  const instances = listed.models.flatMap((m) => (m.loaded_instances || []).map((i) => i.id)).filter(Boolean);
  const unloaded = [];
  for (const id of instances) {
    if (await call(`${base}/api/v1/models/unload`, { instance_id: id })) unloaded.push(id);
  }
  if (unloaded.length < instances.length) return refused('partial', `LM Studio unloaded ${unloaded.length} of ${instances.length} models.`);
  return done(unloaded, unloaded.length ? `LM Studio unloaded ${unloaded.join(', ')}.` : 'LM Studio had nothing loaded.');
};

// impure — Ollama: every running model leaves now
const freeOllama = async (base) => {
  const running = await call(`${base}/api/ps`);
  if (!Array.isArray(running?.models)) return refused('unreadable', 'Ollama did not answer its running list.');
  const names = running.models.map((m) => m.name || m.model).filter(Boolean);
  for (const model of names) await call(`${base}/api/generate`, { model, keep_alive: 0 });
  return done(names, names.length ? `Ollama unloaded ${names.join(', ')}.` : 'Ollama had nothing loaded.');
};

// impure — llama.cpp: the platform's own server only, and only when idle
const freeLlamaServer = async (base) => {
  const cfg = activeLaunchConfig(process.env);
  const port = Number(new URL(base).port);
  const status = port === Number(cfg.port) ? await supervisorStatus(cfg).catch(() => null) : null;
  if (!status?.owned) {
    return refused('not-ours', 'This llama.cpp server was started outside Deus Neuma — stop it where it was started.');
  }
  if (await substrateBusy(cfg)) return refused('busy', 'llama.cpp is answering right now — free it when the answer is done.');
  const stopped = await stopSupervised();
  return stopped.status === 'stopped' || stopped.status === 'not-running'
    ? done([String(port)], 'llama.cpp stopped. Its memory is free.')
    : refused(stopped.status || 'refused', `llama.cpp did not stop (${stopped.status}).`);
};

const FREE = Object.freeze({ 'lm-studio': freeLmStudio, ollama: freeOllama, 'llama-server': freeLlamaServer });

/**
 * impure — free one local server's memory.
 * @param {{providerId: string, endpoint: string}} server
 * @returns {Promise<{ok: boolean, line: string, freed?: string[], code?: string}>}
 */
export const releaseLocalServer = async ({ providerId, endpoint } = {}) => {
  const free = FREE[providerId];
  if (!free) return refused('unknown', `${providerId || 'That server'} cannot be freed from here.`);
  if (!isLoopbackEndpoint(endpoint)) return refused('not-local', 'Only a server on this machine can be freed from here.');
  return free(baseOf(endpoint));
};
