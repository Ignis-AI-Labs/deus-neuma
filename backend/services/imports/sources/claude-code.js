// Claude Code's work, read against the real ~/.claude (docs/work/assistant-import.md, SLICE 2):
//   projects/<encoded folder>/<session>.jsonl — one record a line: `user` (message.content a string
//     the person typed, or blocks: text | tool_result), `assistant` (one block a line: text | tool_use
//     | thinking), `ai-title` {aiTitle}; isMeta / isSidechain lines are the tool's own, not the talk
//   projects/<encoded folder>/memory/*.md — what it kept for that project
//   CLAUDE.md, commands/*.md — what the person told it; skills/<name>/SKILL.md
// A busy project holds hundreds of long sessions: the newest SESSIONS_CARRIED of each are carried as
// pages and every other one is listed in the index by its date — counted, never silently cut.
// impure (reads the disk)
import fs from 'node:fs/promises';
import path from 'node:path';
import { dirNames, fileNames, readNamed, findSkills, firstLines, jsonLines, eachJsonLine } from '../folder-read.js';
import { toolLine } from '../transcript.js';

export const SESSIONS_CARRIED = 30;
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** What a person typed, without the tool's own reminders; '' for a tool's result. Pure. */
const userText = (content) => {
  const raw = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n\n') : '';
  return raw.replace(REMINDER, '').trim();
};

/** A reader for one Claude Code session, fed a record at a time (a session can be gigabytes). */
export const claudeCodeReader = () => {
  const messages = [];
  let title = '';
  let started = null;
  let cwd = null;
  const add = (r) => {
    if (r.type === 'ai-title' && r.aiTitle) title = r.aiTitle;
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta || r.isSidechain || !r.message) return;
    started = started || r.timestamp || null;
    cwd = cwd || r.cwd || null;
    if (r.type === 'user') {
      const text = userText(r.message.content);
      if (text) messages.push({ who: 'you', at: r.timestamp, text });
      return;
    }
    const lines = (Array.isArray(r.message.content) ? r.message.content : []).map((b) => (b.type === 'text' ? b.text
      : b.type === 'tool_use' ? toolLine(b.name, b.input) : '')).filter(Boolean);
    if (!lines.length) return;
    const last = messages[messages.length - 1];
    if (last?.who === 'assistant') last.text += `\n${lines.join('\n')}`;
    else messages.push({ who: 'assistant', at: r.timestamp, text: lines.join('\n') });
  };
  return { add, result: (id) => ({ id, title, started, cwd, messages }) };
};

/** One Claude Code session's records as a conversation. Pure. */
export const claudeCodeSession = (records, id) => {
  const reader = claudeCodeReader();
  records.forEach(reader.add);
  return reader.result(id);
};

// impure — the folder a session worked in, from the first of its opening records that names one
const cwdOf = async (file) => jsonLines(await firstLines(file)).find((r) => r.cwd)?.cwd || null;

// impure — a session listed but not carried: its id, its date, its folder; only its opening read
const listedOnly = async (file, id) => ({ id, title: '', started: (await fs.stat(file)).mtime.toISOString(), cwd: await cwdOf(file), messages: null });

/**
 * Claude Code's projects, sessions, memory, instructions and skills. impure
 * @param {string} root - ~/.claude
 */
export const readClaudeCode = async (root) => {
  const instructions = (await readNamed(root, ['CLAUDE.md'])).entries;
  const commands = await readNamed(root, (await fileNames(path.join(root, 'commands'), /\.md$/)).map((n) => `commands/${n}`));
  instructions.push(...commands.entries);
  const skipped = [...commands.skipped];
  const projects = [];
  const conversations = [];
  for (const dir of await dirNames(path.join(root, 'projects'))) {
    const base = path.join(root, 'projects', dir);
    const memory = await readNamed(base, (await fileNames(path.join(base, 'memory'), /\.md$/)).map((n) => `memory/${n}`));
    skipped.push(...memory.skipped.map((s) => ({ ...s, file: `projects/${dir}/${s.file}` })));
    const sessions = await Promise.all((await fileNames(base, /\.jsonl$/))
      .map(async (n) => ({ n, mtime: (await fs.stat(path.join(base, n))).mtimeMs })));
    sessions.sort((a, b) => b.mtime - a.mtime);
    const convs = [];
    for (const [i, { n }] of sessions.entries()) {
      const file = path.join(base, n);
      const id = n.replace(/\.jsonl$/, '');
      if (i >= SESSIONS_CARRIED) {
        convs.push(await listedOnly(file, id));
      } else {
        const reader = claudeCodeReader();
        await eachJsonLine(file, reader.add);
        convs.push(reader.result(id));
      }
    }
    const cwd = convs.find((c) => c.cwd)?.cwd || null;
    const name = cwd ? path.basename(cwd) : dir;
    if (!memory.entries.length && !convs.length) continue;
    projects.push({ id: dir, name, description: cwd ? `Worked in ${cwd}` : '', instructions: '', files: memory.entries, memory: '' });
    conversations.push(...convs.filter((c) => !c.messages || c.messages.length).map((c) => ({ ...c, project: name })));
  }
  return {
    kind: 'claude-code', label: 'Claude Code', root,
    aboutYou: [], notes: [], persona: [], instructions, skills: await findSkills(path.join(root, 'skills')),
    projects, conversations, scheduled: [], skipped,
  };
};
