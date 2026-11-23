// Codex's work, read against the real ~/.codex (docs/work/assistant-import.md, SLICE 2):
//   sessions/YYYY/MM/DD/rollout-*.jsonl — {type, timestamp, payload}: session_meta {id, cwd};
//     event_msg user_message {message} / agent_message {message}; response_item custom_tool_call or
//     function_call {name, input|arguments}
//   session_index.jsonl {id, thread_name, updated_at} — the titles
//   AGENTS.md, rules/*.rules — what the person told it; skills/<name>/SKILL.md
// Its memories database held no rows on the machine it was read on, so it is not read: unproven.
// The newest SESSIONS_CARRIED sessions of each folder worked in are carried; every other is listed.
// impure (reads the disk)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileNames, readNamed, readPlain, findSkills, firstLine, jsonLines, eachJsonLine } from '../folder-read.js';
import { toolLine } from '../transcript.js';
import { SESSIONS_CARRIED } from './claude-code.js';

/** A reader for one Codex rollout, fed a record at a time (a rollout can be gigabytes). */
export const codexReader = () => {
  const turns = [];
  let meta = {};
  let started = null;
  const say = (who, at, text) => {
    const last = turns[turns.length - 1];
    // consecutive assistant lines (an answer and the tools around it) read as one turn
    if (who === 'assistant' && last?.who === 'assistant') last.text += `\n${text}`;
    else turns.push({ who, at, text });
  };
  const add = (r) => {
    started = started || r.timestamp || null;
    const p = r.payload || {};
    if (r.type === 'session_meta') meta = p;
    else if (r.type === 'event_msg' && p.type === 'user_message' && String(p.message || '').trim()) say('you', r.timestamp, p.message);
    else if (r.type === 'event_msg' && p.type === 'agent_message' && String(p.message || '').trim()) say('assistant', r.timestamp, p.message);
    else if (r.type === 'response_item' && (p.type === 'custom_tool_call' || p.type === 'function_call')) {
      let input = p.input ?? p.arguments;
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* a plain string asks as it is */ } }
      say('assistant', r.timestamp, toolLine(p.name, input));
    }
  };
  return { add, result: (fallbackId) => ({ id: meta.id || fallbackId, title: '', started, cwd: meta.cwd || null, messages: turns }) };
};

/** One Codex rollout's records as a conversation. Pure. */
export const codexSession = (records, fallbackId) => {
  const reader = codexReader();
  records.forEach(reader.add);
  return reader.result(fallbackId);
};

/** Every rollout file under a sessions folder, newest first. impure */
export const rollouts = async (dir) => {
  const out = [];
  const walk = async (d, depth) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && depth < 3) await walk(path.join(d, e.name), depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push(path.join(d, e.name));
    }
  };
  await walk(dir, 0);
  return out.sort().reverse();
};

/**
 * Codex's sessions, instructions and skills. impure
 * @param {string} root - ~/.codex
 */
export const readCodex = async (root) => {
  const instructions = (await readNamed(root, ['AGENTS.md', ...(await fileNames(path.join(root, 'rules'), /\.rules$/)).map((n) => `rules/${n}`)])).entries;
  const titles = new Map();
  const index = await readPlain(path.join(root, 'session_index.jsonl'), 50_000_000);
  for (const row of jsonLines(index?.text || '')) if (row.id && row.thread_name) titles.set(row.id, row.thread_name);
  const skipped = [];
  const carriedPerFolder = new Map();
  const conversations = [];
  for (const file of await rollouts(path.join(root, 'sessions'))) {
    let meta = {};
    try { meta = JSON.parse(await firstLine(file) || '{}').payload || {}; } catch { /* listed by its file */ }
    // a helper session Codex started itself (an approval review, a sub-agent) is not the person's work
    if (meta.parent_thread_id) {
      skipped.push({ file: path.relative(root, file), why: 'a helper session Codex started itself (an approval review or a sub-agent)' });
      continue;
    }
    const folder = meta.cwd || '';
    const count = carriedPerFolder.get(folder) || 0;
    const fallbackId = path.basename(file, '.jsonl');
    let conv;
    if (count < SESSIONS_CARRIED) {
      carriedPerFolder.set(folder, count + 1);
      const reader = codexReader();
      await eachJsonLine(file, reader.add);
      conv = reader.result(fallbackId);
    } else {
      conv = { id: meta.id || fallbackId, title: '', started: (await fs.stat(file)).mtime.toISOString(), cwd: meta.cwd || null, messages: null };
    }
    if (conv.messages && !conv.messages.length) continue;
    conversations.push({ ...conv, title: titles.get(conv.id) || '', project: conv.cwd ? path.basename(conv.cwd) : null });
  }
  return {
    kind: 'codex', label: 'Codex', root,
    aboutYou: [], notes: [], persona: [], instructions, skills: await findSkills(path.join(root, 'skills')),
    projects: [], conversations, scheduled: [], skipped,
  };
};
