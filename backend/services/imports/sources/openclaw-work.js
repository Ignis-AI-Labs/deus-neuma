// OpenClaw's work in progress — its conversations and scheduled jobs, read from its own databases,
// opened read-only. Built to OpenClaw's published layout (openclaw 2026.11.6: the CREATE TABLE
// statements in its dist/ and its docs/reference/session-management-compaction/schema.md), not yet
// to a real install's data (docs/work/assistant-import.md says so):
//   ~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite
//     session_nodes     (session_key, entry_json {label, displayName, sessionStartedAt…}, created_via)
//     session_windows   (session_id, session_key, created_at) — a conversation's windows (resets, rollovers)
//     transcript_events (session_id, seq, event_json | event_zstd) — {type: 'message', id,
//                        supersedesEntryId?, message: {role: user|assistant|toolResult, content}}
//   ~/.openclaw/state/openclaw.sqlite
//     cron_jobs         (name, description, enabled, job_json {schedule, payload}, state_json)
// The default workspace is agent `main`'s; `workspace-<name>` is agent `<name>`'s. A session OpenClaw
// opened for itself (a spawned helper, a cron run, an internal or plugin turn) is left out and named.
// Every table and column is checked before it is read: a layout this reader does not know is said
// so, never guessed at. impure (reads databases)
import path from 'node:path';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import { toolLine } from '../transcript.js';
import { SESSIONS_CARRIED } from './claude-code.js';

const HELPER_ORIGINS = new Set(['spawn', 'cron', 'internal', 'plugin']);
const NEEDS = Object.freeze({
  session_nodes: ['session_key', 'entry_json'],
  session_windows: ['session_id', 'session_key', 'created_at'],
  transcript_events: ['session_id', 'seq', 'event_json', 'event_zstd'],
});
const CRON_NEEDS = ['name', 'enabled', 'job_json'];

// impure — the columns a table has ([] when it is not there)
const columnsOf = (db, table) => db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => r.name);

/** Does a database hold every column a reader needs? Pure given the column lists. */
export const layoutKnown = (have, needs) => Object.entries(needs).every(([t, cols]) => cols.every((c) => (have[t] || []).includes(c)));

/** One stored event as its JSON: plain, or zstd-packed. Pure. */
const eventOf = (row) => {
  try {
    if (row.event_json == null && typeof zlib.zstdDecompressSync !== 'function') return null;
    return JSON.parse(row.event_json ?? zlib.zstdDecompressSync(row.event_zstd).toString('utf8'));
  } catch {
    return null;
  }
};

const textParts = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n\n') : '');

/** An OpenClaw transcript's events as the talk: rewritten messages read as their latest copy. Pure. */
export const openclawMessages = (events) => {
  const superseded = new Set(events.map((e) => e?.supersedesEntryId).filter(Boolean));
  const messages = [];
  for (const e of events) {
    if (e?.type !== 'message' || superseded.has(e.id) || !e.message) continue;
    const { role, content } = e.message;
    if (role === 'user') {
      const text = textParts(content).trim();
      if (text) messages.push({ who: 'you', at: e.timestamp || null, text });
    } else if (role === 'assistant') {
      const lines = (Array.isArray(content) ? content : [{ type: 'text', text: String(content || '') }])
        .map((p) => (p?.type === 'text' ? p.text : p?.type === 'toolCall' ? toolLine(p.name, p.arguments) : '')).filter(Boolean);
      if (!lines.length) continue;
      const last = messages[messages.length - 1];
      if (last?.who === 'assistant') last.text += `\n${lines.join('\n')}`;
      else messages.push({ who: 'assistant', at: e.timestamp || null, text: lines.join('\n') });
    }
  }
  return messages;
};

/** An OpenClaw job's schedule in words. Pure. */
export const openclawSchedule = (s = {}) => (s.kind === 'cron' ? `cron ${s.expr}${s.tz ? ` (${s.tz})` : ''}`
  : s.kind === 'every' && s.everyMs ? `every ${Math.round(s.everyMs / 60_000)} minute(s)`
    : s.kind === 'at' ? `once, at ${s.at}` : JSON.stringify(s));

const exists = (p) => fs.lstat(p).then(() => true, () => false);

// impure — open a database read-only, or null when it is not there. node:sqlite is loaded only here, so a
// runtime without it costs this one source, never the backend's boot.
const openDb = async (file) => {
  if (!(await exists(file))) return null;
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(file, { readOnly: true });
};

/**
 * OpenClaw's conversations for one workspace, and the scheduled jobs. impure
 * @param {string} root - the workspace folder (~/.openclaw/workspace or ~/.openclaw/workspace-<name>)
 */
export const readOpenclawWork = async (root) => {
  const stateDir = path.dirname(root);
  const base = path.basename(root);
  const agentId = base === 'workspace' ? 'main' : base.replace(/^workspace-/, '');
  const skipped = [];
  const conversations = [];
  const db = await openDb(path.join(stateDir, 'agents', agentId, 'agent', 'openclaw-agent.sqlite'));
  if (db) {
    try {
      const have = Object.fromEntries(Object.keys(NEEDS).map((t) => [t, columnsOf(db, t)]));
      if (!layoutKnown(have, NEEDS)) {
        skipped.push({ file: `agents/${agentId}/agent/openclaw-agent.sqlite`, why: 'this OpenClaw keeps its conversations in a layout this import does not read yet' });
      } else {
        const origin = have.session_nodes.includes('created_via') ? 'created_via' : 'NULL AS created_via';
        const nodes = db.prepare(`SELECT session_key, entry_json, ${origin} FROM session_nodes`).all()
          .map((n) => ({ ...n, entry: (() => { try { return JSON.parse(n.entry_json); } catch { return {}; } })() }));
        const windows = db.prepare('SELECT session_id FROM session_windows WHERE session_key = ? ORDER BY created_at');
        const events = db.prepare('SELECT event_json, event_zstd FROM transcript_events WHERE session_id = ? ORDER BY seq');
        const own = nodes.filter((n) => !HELPER_ORIGINS.has(n.created_via));
        for (const n of nodes) if (HELPER_ORIGINS.has(n.created_via)) skipped.push({ file: n.session_key, why: `a session OpenClaw opened for itself (${n.created_via})` });
        own.sort((a, b) => (b.entry.updatedAt || 0) - (a.entry.updatedAt || 0));
        for (const [i, n] of own.entries()) {
          const conv = {
            id: n.session_key, title: n.entry.label || n.entry.displayName || n.entry.subject || '',
            started: n.entry.sessionStartedAt || null, project: agentId, messages: null,
          };
          if (i < SESSIONS_CARRIED) {
            const all = windows.all(n.session_key).flatMap((w) => events.all(w.session_id).map(eventOf));
            conv.messages = openclawMessages(all);
            if (!conv.messages.length) continue;
          }
          conversations.push(conv);
        }
      }
    } finally {
      db.close();
    }
  }
  const scheduled = [];
  const state = await openDb(path.join(stateDir, 'state', 'openclaw.sqlite'));
  if (state) {
    try {
      const cols = columnsOf(state, 'cron_jobs');
      if (cols.length && CRON_NEEDS.every((c) => cols.includes(c))) {
        const pick = ['name', 'enabled', 'job_json', cols.includes('description') ? 'description' : 'NULL AS description', cols.includes('state_json') ? 'state_json' : "'{}' AS state_json", cols.includes('agent_id') ? 'agent_id' : 'NULL AS agent_id'];
        for (const j of state.prepare(`SELECT ${pick.join(', ')} FROM cron_jobs`).all()) {
          if (j.agent_id && j.agent_id !== agentId) continue;
          let job = {};
          let run = {};
          try { job = JSON.parse(j.job_json); } catch { /* the row still names the job */ }
          try { run = JSON.parse(j.state_json || '{}'); } catch { /* no run state */ }
          scheduled.push({
            name: j.name, schedule: openclawSchedule(job.schedule), enabled: Boolean(j.enabled),
            prompt: job.payload?.message || job.payload?.text || j.description || '',
            lastRun: run.lastRunAtMs ? new Date(run.lastRunAtMs).toISOString() : null,
            deliver: job.delivery?.channel || null, skills: [],
          });
        }
      } else if (cols.length) {
        skipped.push({ file: 'state/openclaw.sqlite', why: 'this OpenClaw keeps its scheduled jobs in a layout this import does not read yet' });
      }
    } finally {
      state.close();
    }
  }
  return { conversations, scheduled, skipped };
};
