// team-channel.js — the team's own channel, and the ROOM it is read in.
//
// Design note, 2026-10-12: […] Members worked side by side blind: each read the board
// once, when it was briefed, and nothing a teammate found afterwards could
// reach it — a member building the offer page could not ask the member
// validating the offer what the offer was.
//
// Members (and their lead, and the operator) POST to the whole team or to
// one teammate (the team/post intent; the operator's route). Nothing is ever
// pushed into a member's turn — the harness injects nothing mid-turn (the
// nudge repeal, 7d99f6b11). A member READS when it chooses, with the file
// tools it already has: the platform keeps the TEAM ROOM inside the team's
// workspace (<root>/.team/, which deliveries skip):
//   channel.md — every post, oldest first, who to whom;
//   board.md   — who is doing what right now, with each member's status;
//   parts/     — every finished part, whole, as it lands.
// The room is the platform's record — members cannot write it
// (tool-sandbox.js); the run record keeps the channel through a resume.
//
// impure — the live entry's channel, the room's files, the run's frames.

import fs from 'fs/promises';
import path from 'path';
import { broadcastRun } from './team-run-live.js';
import { isWithinRoots } from './sandbox-path-policy.js';
import { createLogger } from './logger.js';

const log = createLogger('TeamChannel');

/** One post stays short — a message, not a deliverable (deliverables are files). */
export const CHANNEL_POST_MAX_CHARS = 2000;
/** How many posts a run keeps. */
export const CHANNEL_KEEP = 300;
/** The room's folder inside the team workspace. */
export const ROOM_DIR = '.team';

/** @returns {string} the room's folder for a team workspace root */
export const roomOf = (root) => path.join(root, ROOM_DIR);

const clock = (at) => String(at).slice(11, 19);

// pure — who a post is for, resolved against the run's board: a step id, a
// member's name, or nobody named (the whole team). Null when the name is not
// on the team.
export const resolveRecipient = (board, to) => {
  const want = typeof to === 'string' ? to.trim().toLowerCase() : '';
  if (!want || ['all', 'everyone', 'team', 'the team'].includes(want)) return { stepId: null, member: 'everyone' };
  const hit = (board || []).find((e) => e.id.toLowerCase() === want || String(e.member || '').toLowerCase() === want);
  return hit ? { stepId: hit.id, member: hit.member || hit.id } : null;
};

// pure — channel.md, whole.
const renderChannel = (name, messages) => [
  `# TEAM CHANNEL${name ? ` — ${name}` : ''}`,
  'Posts from your teammates, your lead and your operator, oldest first. To post: file a team/post intent. The platform writes this file — it cannot be edited.',
  '',
  ...(messages.length ? messages.map((m) => `[${clock(m.at)}] ${m.from} → ${m.to}: ${m.text}`) : ['(nothing posted yet)']),
  '',
].join('\n');

// pure — board.md, whole.
const renderBoard = (name, board, at) => [
  `# TEAM BOARD${name ? ` — ${name}` : ''} (as of ${clock(at)})`,
  'Who is doing what. Finished parts are in parts/, whole.',
  '',
  ...(board || []).map((e) => `${e.id} · ${e.member || e.neumaId}${e.role ? ` · ${e.role}` : ''} · ${String(e.state || 'waiting').toUpperCase()}${e.status ? `\n    ${String(e.status).replace(/\n/g, '\n    ')}` : ''}`),
  '',
].join('\n');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member';

/**
 * The team room's writer. Every file is rewritten whole from the run's truth
 * (never appended), one write at a time per file — a member that clobbered a
 * file by some other road is set right by the next write.
 *
 * @param {{root: string, name?: ?string}} args - the team workspace root, the run's name
 * @returns {Readonly<{root: string, channel: Function, board: Function, part: Function}>}
 */
export const createTeamRoom = ({ root, name = null }) => {
  const dir = roomOf(root);
  const chains = new Map();
  const write = (rel, text) => {
    const file = path.join(dir, rel);
    // The platform's own write, which the tool sandbox never sees: it stays in the room.
    if (!isWithinRoots(file, [dir])) {
      log.warn('team room file refused — it falls outside the room', { file });
      return Promise.resolve();
    }
    const prior = chains.get(file) || Promise.resolve();
    const next = prior
      .then(() => fs.mkdir(path.dirname(file), { recursive: true }))
      .then(() => fs.writeFile(file, text, 'utf8'))
      .catch((err) => log.warn('team room file not written', { file, error: err.message }));
    chains.set(file, next);
    return next;
  };
  return Object.freeze({
    root,
    channel: (messages) => write('channel.md', renderChannel(name, messages)),
    board: (board) => write('board.md', renderBoard(name, board, new Date().toISOString())),
    part: (entry, text) => write(path.join('parts', `${entry.id}-${slug(entry.member || entry.neumaId)}.md`), `# ${entry.id} — ${entry.member || entry.neumaId}${entry.role ? ` (${entry.role})` : ''}\n\n${text}\n`),
  });
};

/**
 * Post to a run's channel: kept on the run (and its record), written to the
 * room, sent to every desk of the operator.
 *
 * @param {Object} entry - the live registry entry
 * @param {{fromStep?: ?string, from: string, to?: ?string, text: string}} post
 * @returns {{ok: true, message: Object} | {ok: false, reason: string}}
 */
export const postToChannel = (entry, { fromStep = null, from, to = null, text }) => {
  const words = typeof text === 'string' ? text.trim() : '';
  if (!words) return { ok: false, reason: 'a post needs words' };
  if (words.length > CHANNEL_POST_MAX_CHARS) return { ok: false, reason: `a post stays under ${CHANNEL_POST_MAX_CHARS} characters — put longer work in a file in the team workspace and post where it is` };
  const recipient = resolveRecipient(entry.board, to);
  if (!recipient) {
    const names = (entry.board || []).map((e) => `${e.member || e.id} (${e.id})`).join(', ');
    return { ok: false, reason: `"${to}" is not on this team — post to everyone, or to one of: ${names}` };
  }
  const message = Object.freeze({
    n: (entry.channel.at(-1)?.n ?? 0) + 1,
    at: new Date().toISOString(),
    fromStep,
    from,
    toStep: recipient.stepId,
    to: recipient.member,
    text: words,
  });
  entry.channel = [...entry.channel, message].slice(-CHANNEL_KEEP);
  entry.onChannel?.(message);
  entry.room?.channel(entry.channel);
  broadcastRun(entry, { type: 'operator:team_message', id: entry.id, ...message });
  return { ok: true, message };
};
