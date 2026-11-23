// transcript — a conversation from another assistant, written as a page a being can read. Pure.
//
// Every source (a Claude or ChatGPT export, Hermes, Claude Code, Codex) is read into the same shape:
//   { id, title, started, project?, carried?, messages: [{ who: 'you'|'assistant', at?, text }] }
// and written the same way: who said it, when, and what — the operator's own words and the
// assistant's answers in full. A tool the assistant used is one line (its name and what it was asked);
// its raw output and the assistant's private reasoning are not carried, and the page says so.
// The index names EVERY conversation, carried or not — a count you can open, never a silent cut.

const SLUG_MAX = 48;
const INPUT_MAX = 160;

/** A file-safe slug of a title. Pure. */
export const slugOf = (text) => String(text || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '') || 'untitled';

/** An instant as YYYY-MM-DD, or '' when there is none. Pure. */
export const dayOf = (at) => {
  const t = typeof at === 'number' ? at : Date.parse(at || '');
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : '';
};

const timeOf = (at) => {
  const t = typeof at === 'number' ? at : Date.parse(at || '');
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '';
};

/** The title a conversation shows: its own, or its first words. Pure. */
export const titleOf = (conv) => {
  const own = String(conv.title || '').trim();
  if (own) return own;
  const first = (conv.messages || []).find((m) => m.who === 'you' && m.text.trim());
  return first ? first.text.trim().split('\n')[0].slice(0, 80) : 'Untitled';
};

/** The file a conversation is written to, unique by its id. Pure. */
export const conversationFile = (conv) =>
  `${dayOf(conv.started) || 'undated'}-${slugOf(titleOf(conv))}-${slugOf(conv.id).slice(0, 8)}.md`;

/**
 * One conversation as a page.
 * @param {object} conv
 * @param {string} assistantName - who answered ("Claude", "ChatGPT", "Codex"…)
 */
export const renderConversation = (conv, assistantName) => {
  const head = [
    `# ${titleOf(conv)}`,
    '',
    [`${assistantName}`, dayOf(conv.started) ? `started ${dayOf(conv.started)}` : '', `${conv.messages.length} messages`,
      conv.project ? `project: ${conv.project}` : ''].filter(Boolean).join(' · '),
    '',
  ];
  const body = conv.messages.map((m) => {
    const who = m.who === 'you' ? 'You' : assistantName;
    const when = timeOf(m.at);
    return `**${who}**${when ? ` · ${when}` : ''}\n\n${m.text.trim() || '(nothing written)'}\n`;
  });
  return [...head, ...body].join('\n');
};

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * The index of every conversation brought over (and every one that was not), as a table.
 * @param {object[]} convs - each with `file` when it was carried
 * @param {string} assistantName
 */
export const renderIndex = (convs, assistantName) => {
  const sorted = [...convs].sort((a, b) => String(b.started || '').localeCompare(String(a.started || '')));
  const carried = sorted.filter((c) => c.file).length;
  const lines = [
    `# Conversations with ${assistantName}`,
    '',
    `${sorted.length} conversation(s); ${carried} carried here as pages${carried < sorted.length ? `, ${sorted.length - carried} listed only (older sessions of a busy project)` : ''}.`,
    'Each page holds what was said in full. A tool the assistant used is one line; its raw output and private reasoning are not carried.',
    '',
    '| Date | Title | Messages | Project | Page |',
    '| --- | --- | --- | --- | --- |',
    ...sorted.map((c) => `| ${dayOf(c.started) || '—'} | ${cell(c.messages || c.title ? titleOf(c) : 'not read')} | ${c.messages ? c.messages.length : '—'} | ${cell(c.project || '—')} | ${c.file ? `[open](${c.file})` : 'not carried'} |`),
    '',
  ];
  return lines.join('\n');
};

/** The jobs an assistant ran on a schedule, as a page — listed, never started here. Pure. */
export const renderScheduled = (jobs, assistantName) => [
  `# Scheduled jobs ${assistantName} ran`,
  '',
  'Listed so nothing is forgotten. None of these runs here. If one should, your operator sets it up as a routine.',
  '',
  ...jobs.map((j) => [
    `## ${j.name || 'Unnamed job'}`,
    '',
    `- When: ${j.schedule || '—'}`,
    `- On: ${j.enabled === false ? 'paused' : 'yes'}`,
    j.lastRun ? `- Last ran: ${j.lastRun}` : null,
    j.deliver ? `- Sent its result to: ${j.deliver}` : null,
    j.skills?.length ? `- Used skills: ${j.skills.join(', ')}` : null,
    '',
    j.prompt ? `What it was asked:\n\n${j.prompt}\n` : null,
  ].filter((l) => l !== null).join('\n')),
].join('\n');

/** One line for a tool the assistant used: its name and what it was asked. Pure. */
export const toolLine = (name, input, said = '') => {
  // a tool asked in code (Codex's exec) reads by the command inside it
  const inCode = typeof input === 'string' ? /\bcmd:\s*"((?:[^"\\]|\\.)*)"/.exec(input)?.[1] : null;
  const ask = said || inCode || (input && typeof input === 'object'
    ? String(input.command ?? input.cmd ?? input.query ?? input.url ?? input.path ?? input.file_path ?? input.pattern ?? JSON.stringify(input))
    : String(input ?? ''));
  return `> used ${name}${ask ? `: ${ask.replace(/\s+/g, ' ').slice(0, INPUT_MAX)}` : ''}`;
};
