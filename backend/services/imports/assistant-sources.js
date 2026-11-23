// assistant-sources — what other assistants left on this computer, found and read as it is.
//
// Design note, 2026-11-17: […]; 11-22:
// […]. Read straight off this
// computer's disk (or pasted by the operator) — nothing is sent anywhere. What crosses is MATERIAL,
// never identity: a neuma is summoned, not imported (import-land.js says so in the README).
//
// The sources, each read against its real layout (docs/work/assistant-import.md):
//   openclaw       ~/.openclaw/workspace[-<profile>]: USER.md, MEMORY.md, memory/YYYY-MM-DD.md, SOUL.md,
//                  IDENTITY.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, skills/; its conversations and scheduled
//                  jobs from its databases (sources/openclaw-work.js)
//   hermes         ~/.hermes (profiles: ~/.hermes/profiles/<name>): memories/USER.md + MEMORY.md (§-split),
//                  SOUL.md, skills/, sessions/, cron/jobs.json (sources/hermes-work.js)
//   claude-code    ~/.claude (sources/claude-code.js)
//   codex          ~/.codex (sources/codex.js)
//   claude-export  a Claude.ai data export, zip or folder (sources/claude-export.js)
//   chatgpt-export a ChatGPT data export, zip or folder (sources/chatgpt-export.js) — unverified
// impure (reads the disk)
import fs from 'node:fs/promises';
import path from 'node:path';
import { dirNames, fileNames, readNamed, findSkills } from './folder-read.js';
import { exportKind, openExport } from './export-files.js';
import { readHermesWork } from './sources/hermes-work.js';
import { readOpenclawWork } from './sources/openclaw-work.js';
import { readClaudeCode } from './sources/claude-code.js';
import { readCodex, rollouts } from './sources/codex.js';
import { readClaudeExport } from './sources/claude-export.js';
import { readChatgptExport } from './sources/chatgpt-export.js';

export { FILE_MAX } from './folder-read.js';
export const PASTE_MAX = 400_000;

const WORKSPACE_FILES = Object.freeze({
  openclaw: Object.freeze({
    aboutYou: ['USER.md'], notes: ['MEMORY.md'], noteDir: 'memory',
    persona: ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md'],
  }),
  hermes: Object.freeze({
    aboutYou: ['memories/USER.md', 'USER.md'], notes: ['memories/MEMORY.md', 'MEMORY.md'], noteDir: null,
    persona: ['SOUL.md'],
  }),
});

export const SOURCES = Object.freeze({
  openclaw: 'OpenClaw', hermes: 'Hermes Agent', 'claude-code': 'Claude Code', codex: 'Codex',
  'claude-export': 'Claude', 'chatgpt-export': 'ChatGPT',
});
export const PASTED_FROM = Object.freeze({ chatgpt: 'ChatGPT', claude: 'Claude', other: 'another assistant' });
// Where a downloaded export usually sits; only the top of each is looked at.
const EXPORT_PLACES = Object.freeze(['Downloads', 'Desktop', 'Documents']);

/** Hermes keeps one entry per block, split by a line holding only §; shown as separate blocks. Pure. */
export const hermesEntries = (text) => String(text).split(/^\s*§\s*$/m).map((e) => e.trim()).filter(Boolean).join('\n\n---\n\n');

const EMPTY = Object.freeze({ aboutYou: [], notes: [], persona: [], instructions: [], skills: [], conversations: [], projects: [], scheduled: [], skipped: [] });

// impure — OpenClaw's or Hermes's own files (and Hermes's sessions and jobs)
const readWorkspace = async (kind, root) => {
  const files = WORKSPACE_FILES[kind];
  const shape = kind === 'hermes' ? hermesEntries : (t) => t;
  const aboutYou = await readNamed(root, files.aboutYou, shape);
  const notes = await readNamed(root, files.notes, shape);
  if (files.noteDir) {
    const daily = await readNamed(root, (await fileNames(path.join(root, files.noteDir), /\.md$/i)).map((n) => `${files.noteDir}/${n}`));
    notes.entries.push(...daily.entries);
    notes.skipped.push(...daily.skipped);
  }
  const persona = await readNamed(root, files.persona);
  const work = kind === 'hermes' ? await readHermesWork(root) : await readOpenclawWork(root).catch((e) => ({
    conversations: [], scheduled: [], skipped: [{ file: 'agents/', why: `OpenClaw's databases could not be read: ${e.message}` }],
  }));
  return {
    ...EMPTY, kind, label: SOURCES[kind], root,
    aboutYou: aboutYou.entries, notes: notes.entries, persona: persona.entries,
    skills: await findSkills(path.join(root, 'skills')),
    conversations: work.conversations, scheduled: work.scheduled,
    skipped: [...aboutYou.skipped, ...notes.skipped, ...persona.skipped, ...work.skipped],
  };
};

/**
 * Read one source into the material an import carries. impure
 * @param {string} kind - a SOURCES key
 * @param {string} root - its folder, or an export's .zip
 */
export const readAssistant = async (kind, root) => {
  if (!SOURCES[kind]) throw new Error(`not an assistant this import knows: ${kind}`);
  const read = kind === 'claude-code' ? await readClaudeCode(root)
    : kind === 'codex' ? await readCodex(root)
      : kind === 'claude-export' ? await readClaudeExport(root)
        : kind === 'chatgpt-export' ? await readChatgptExport(root)
          : await readWorkspace(kind, root);
  return { ...EMPTY, ...read };
};

// impure — how many files of a kind sit in a folder (for the survey; nothing is read)
const countFiles = async (dir, pattern) => (await fileNames(dir, pattern)).length;

// impure — the cheap survey of one place: counts that need no transcript read (null = counted on bring)
const survey = async (place) => {
  const { kind, root } = place;
  if (kind === 'openclaw' || kind === 'hermes') {
    const read = await readWorkspace(kind, root);
    return { aboutYou: read.aboutYou.length, notes: read.notes.length, conversations: read.conversations.length, projects: 0, scheduled: read.scheduled.length, skills: read.skills.length };
  }
  if (kind === 'claude-code') {
    const projects = await dirNames(path.join(root, 'projects'));
    let conversations = 0;
    for (const p of projects) conversations += await countFiles(path.join(root, 'projects', p), /\.jsonl$/);
    return { aboutYou: 0, notes: 0, conversations, projects: projects.length, scheduled: 0, skills: (await findSkills(path.join(root, 'skills'))).length };
  }
  if (kind === 'codex') {
    return { aboutYou: 0, notes: 0, conversations: (await rollouts(path.join(root, 'sessions'))).length, projects: 0, scheduled: 0, skills: (await findSkills(path.join(root, 'skills'))).length };
  }
  return { aboutYou: null, notes: 0, conversations: null, projects: place.projects ?? null, scheduled: 0, skills: 0 };
};

const isDir = async (p) => (await fs.lstat(p).catch(() => null))?.isDirectory() === true;

// impure — the data exports sitting in Downloads, Desktop or Documents (a .zip, or the folder it unpacked to)
const findExports = async (home) => {
  const out = [];
  for (const place of EXPORT_PLACES) {
    const dir = path.join(home, place);
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (!(entry.isDirectory() || (entry.isFile() && /\.zip$/i.test(entry.name)))) continue;
      let ex = null;
      try {
        ex = await openExport(full);
        const kind = exportKind(ex.names);
        if (kind) out.push({ kind, root: full, profile: null, projects: kind === 'claude-export' ? ex.names.filter((n) => /^projects\/[^/]+\.json$/.test(n)).length : null });
      } catch { /* not a zip we can read, or not an export: not listed */ } finally {
        await ex?.close();
      }
    }
  }
  return out;
};

/**
 * Every assistant found in this person's home folder, each with what it holds. impure
 * @param {string} home
 */
export const findAssistants = async (home) => {
  const places = [];
  const openclaw = path.join(home, '.openclaw');
  for (const name of await dirNames(openclaw)) {
    if (name === 'workspace' || name.startsWith('workspace-')) {
      places.push({ kind: 'openclaw', root: path.join(openclaw, name), profile: name === 'workspace' ? null : name.slice('workspace-'.length) });
    }
  }
  const hermes = path.join(home, '.hermes');
  if (await isDir(hermes)) places.push({ kind: 'hermes', root: hermes, profile: null });
  for (const name of await dirNames(path.join(hermes, 'profiles'))) places.push({ kind: 'hermes', root: path.join(hermes, 'profiles', name), profile: name });
  if (await isDir(path.join(home, '.claude', 'projects'))) places.push({ kind: 'claude-code', root: path.join(home, '.claude'), profile: null });
  if (await isDir(path.join(home, '.codex', 'sessions'))) places.push({ kind: 'codex', root: path.join(home, '.codex'), profile: null });
  places.push(...await findExports(home));

  const found = [];
  for (const place of places) {
    const counts = await survey(place);
    if (Object.values(counts).some((n) => n === null || n > 0)) {
      found.push({ kind: place.kind, root: place.root, profile: place.profile, label: SOURCES[place.kind], counts });
    }
  }
  return found;
};

/**
 * What the operator pasted back from ChatGPT, Claude or another assistant, as material. Pure.
 * @param {string} from - a PASTED_FROM key
 * @param {string} text
 */
export const readPasted = (from, text) => {
  if (!PASTED_FROM[from]) throw new Error(`not a source this import knows: ${from}`);
  const body = String(text ?? '').trim();
  if (!body) throw new Error('nothing was pasted');
  if (body.length > PASTE_MAX) throw new Error(`that is more than ${PASTE_MAX.toLocaleString('en-US')} characters — paste it in parts`);
  return { ...EMPTY, kind: from, label: PASTED_FROM[from], root: null, aboutYou: [{ name: 'what-it-knew.md', text: body }] };
};
