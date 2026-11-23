// import-land — an import, set down in the house's own ground as material its beings can read.
//
// `<house ground>/imports/<source>-<date>/`, never over an earlier import:
//   README.md        — for a being: another assistant wrote this, it may be wrong, keep what is true in
//                      your own words; nothing here is your identity
//   about-you/       — what that assistant knew about the operator
//   notes/           — its notes on its work
//   persona/         — how it was told to be, reference only
//   instructions/    — what the operator told it (CLAUDE.md, AGENTS.md, rules, commands)
//   conversations/   — one page per conversation + index.md naming every one, carried or not
//   projects/<name>/ — README.md (what it was, its instructions, its memory) + files/
//   scheduled.md     — the jobs it ran on a schedule; listed, never started here
//   skills-held/     — skills that carry code, held for the operator (third-party code is checked first)
// A skill of words only, meeting our SKILL.md contract, joins the skills library — never over one
// already there. Every count in the report names its items. impure (writes the disk)
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadManifest } from '../../../core/skills/manifest.js';
import { conversationFile, renderConversation, renderIndex, renderScheduled, slugOf } from './transcript.js';

// impure — a new folder named `<base>`, or `<base>-2`, `-3`… if an earlier one holds the name
const freshDir = async (parent, base) => {
  for (let n = 1; n < 1000; n += 1) {
    const dir = path.join(parent, n === 1 ? base : `${base}-${n}`);
    try {
      await fs.mkdir(dir);
      return dir;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('too many with this name');
};

/** A relative name made safe to write under a folder: no climbing out, no odd characters. Pure. */
export const safeRel = (name) => String(name).split(/[\\/]+/).filter((seg) => seg && seg !== '.' && seg !== '..')
  .map((seg) => seg.replace(/[^\w.\- ]+/g, '_').slice(0, 120)).join('/') || 'unnamed';

// impure — write entries under a folder, keeping their (made-safe) relative names
const writeEntries = async (dir, entries) => {
  for (const { name, text } of entries) {
    const file = path.join(dir, safeRel(name));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
};

// impure — copy a skill folder, files only (links were never listed)
const copySkill = async (from, to, files) => {
  for (const rel of files) {
    const target = path.join(to, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(from, rel), target, fs.constants.COPYFILE_EXCL);
  }
};

const exists = (p) => fs.lstat(p).then(() => true, () => false);

/** The README a being reads first. Pure. */
export const importReadme = (bundle, report, day) => [
  `# Brought over from ${bundle.label} — ${day}`,
  '',
  `Your operator brought this over from ${bundle.label}${bundle.root ? ` (${bundle.root})` : ' (pasted in by your operator)'} on ${day}.`,
  'Another assistant wrote it. It may be out of date or wrong, and it is not yours.',
  '',
  report.aboutYou.length ? `- about-you/ — what that assistant knew about your operator: ${report.aboutYou.join(', ')}. Keep what is true, in your own words, where it helps your work.` : null,
  report.notes.length ? `- notes/ — that assistant's notes on its work: ${report.notes.length} file(s).` : null,
  report.persona.length ? `- persona/ — how that assistant was told to be: ${report.persona.join(', ')}. Reference only. You are not it, and nothing here is your identity.` : null,
  report.instructions.length ? `- instructions/ — what your operator told that assistant: ${report.instructions.join(', ')}. Your operator's own words; ask before treating any of it as a rule for you.` : null,
  report.conversations.total ? `- conversations/ — ${report.conversations.total} conversation(s); ${report.conversations.carried} as pages. Start at conversations/index.md.` : null,
  report.projects.length ? `- projects/ — the work it held by project: ${report.projects.join(', ')}.` : null,
  report.scheduled.length ? `- scheduled.md — ${report.scheduled.length} job(s) it ran on a schedule. None runs here; ask your operator before setting one up.` : null,
  report.skillsInstalled.length ? `- Skills now in the house's skills library: ${report.skillsInstalled.join(', ')}.` : null,
  report.skillsHeld.length ? `- skills-held/ — skills held for your operator to look over before any is used: ${report.skillsHeld.map((s) => `${s.name} (${s.why})`).join('; ')}.` : null,
  '',
  'Nothing here was sent anywhere; it stayed on this computer.',
  '',
].filter((line) => line !== null).join('\n');

/** A project's own page. Pure. */
const projectPage = (p, label) => [
  `# ${p.name}`,
  '',
  `A project in ${label}.${p.description ? ` ${p.description}` : ''}`,
  '',
  p.instructions ? `## What it was told for this project\n\n${p.instructions}\n` : null,
  p.memory ? `## What it remembered about this project\n\n${p.memory}\n` : null,
  p.files.length ? `## Files\n\n${p.files.map((f) => `- files/${safeRel(f.name)}`).join('\n')}\n` : null,
].filter((l) => l !== null).join('\n');

// impure — the conversations: a page for each carried one, an index naming all
const landConversations = async (dir, bundle) => {
  if (!bundle.conversations.length) return { total: 0, carried: 0 };
  const convDir = path.join(dir, 'conversations');
  await fs.mkdir(convDir, { recursive: true });
  const indexed = [];
  for (const conv of bundle.conversations) {
    if (!conv.messages) { indexed.push({ ...conv, file: null }); continue; }
    const file = conversationFile(conv);
    await fs.writeFile(path.join(convDir, file), renderConversation(conv, bundle.label));
    indexed.push({ ...conv, file });
  }
  await fs.writeFile(path.join(convDir, 'index.md'), renderIndex(indexed, bundle.label));
  return { total: indexed.length, carried: indexed.filter((c) => c.file).length };
};

// impure — each project in its own folder
const landProjects = async (dir, bundle) => {
  const names = [];
  if (!bundle.projects.length) return names;
  await fs.mkdir(path.join(dir, 'projects'), { recursive: true });
  for (const p of bundle.projects) {
    const pdir = await freshDir(path.join(dir, 'projects'), slugOf(p.name));
    await fs.writeFile(path.join(pdir, 'README.md'), projectPage(p, bundle.label));
    await writeEntries(path.join(pdir, 'files'), p.files);
    names.push(p.name);
  }
  return names;
};

// impure — skills: words-only into the library, the rest held
const landSkills = async (dir, bundle, skillsRoot, report) => {
  for (const skill of bundle.skills) {
    let manifest;
    try {
      manifest = await loadManifest(skill.dir);
    } catch (error) {
      report.skillsHeld.push({ name: skill.folder, why: `its SKILL.md does not meet the skill contract: ${error.message}` });
      await copySkill(skill.dir, path.join(dir, 'skills-held', safeRel(skill.folder)), skill.files).catch(() => {});
      continue;
    }
    if (skill.hasCode) {
      report.skillsHeld.push({ name: manifest.name, why: 'it carries code' });
      await copySkill(skill.dir, path.join(dir, 'skills-held', manifest.name), skill.files).catch(() => {});
    } else if (await exists(path.join(skillsRoot, manifest.name))) {
      report.skillsSkipped.push({ name: manifest.name, why: 'a skill with this name is already in the library' });
    } else {
      await copySkill(skill.dir, path.join(skillsRoot, manifest.name), skill.files);
      report.skillsInstalled.push(manifest.name);
    }
  }
};

/**
 * Set an import down in the house ground. impure
 * @param {object} bundle - from readAssistant / readPasted
 * @param {{houseRoot: string, skillsRoot: string, now?: Date}} where
 */
export const landImport = async (bundle, { houseRoot, skillsRoot, now = new Date() }) => {
  // the operator's own calendar day, not UTC's
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const parent = path.join(houseRoot, 'imports');
  await fs.mkdir(parent, { recursive: true });
  const dir = await freshDir(parent, `${bundle.kind}${bundle.profile ? `-${slugOf(bundle.profile)}` : ''}-${day}`);
  await writeEntries(path.join(dir, 'about-you'), bundle.aboutYou);
  await writeEntries(path.join(dir, 'notes'), bundle.notes);
  await writeEntries(path.join(dir, 'persona'), bundle.persona);
  await writeEntries(path.join(dir, 'instructions'), bundle.instructions);
  if (bundle.scheduled.length) await fs.writeFile(path.join(dir, 'scheduled.md'), renderScheduled(bundle.scheduled, bundle.label));

  const report = {
    dir,
    aboutYou: bundle.aboutYou.map((e) => e.name),
    notes: bundle.notes.map((e) => e.name),
    persona: bundle.persona.map((e) => e.name),
    instructions: bundle.instructions.map((e) => e.name),
    conversations: await landConversations(dir, bundle),
    projects: await landProjects(dir, bundle),
    scheduled: bundle.scheduled.map((j) => j.name || 'Unnamed job'),
    skillsInstalled: [], skillsHeld: [], skillsSkipped: [],
    skipped: [...bundle.skipped],
  };
  await landSkills(dir, bundle, skillsRoot, report);
  await fs.writeFile(path.join(dir, 'README.md'), importReadme(bundle, report, day));
  return report;
};
