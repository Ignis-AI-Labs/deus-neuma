/**
 * BRING YOUR OLD ASSISTANT — WORK IN PROGRESS (docs/work/assistant-import.md, SLICE 2). RULE 0: the
 * real readers and the real landing on real files, laid out the way each source's real data was found
 * on the machine it was built on (2026-11-22) — the shapes copied, the words made up. A Claude export
 * arrives as a real .zip (test/helpers/zip-kit.js, checked against the system unzip). Nothing mocked.
 * ChatGPT's shape is the published one; no real ChatGPT export has been run yet (the ledger says so).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { writeZip } from '../helpers/zip-kit.js';
import { findAssistants, readAssistant } from '../../backend/services/imports/assistant-sources.js';
import { landImport } from '../../backend/services/imports/import-land.js';
import { SESSIONS_CARRIED } from '../../backend/services/imports/sources/claude-code.js';

let dir, home, ground, skillsRoot;
const put = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
};
const lines = (...records) => records.map((r) => JSON.stringify(r)).join('\n');
const read = (file) => fs.readFile(file, 'utf8');
const land = async (kind, root) => landImport(await readAssistant(kind, root), { houseRoot: ground, skillsRoot });

beforeAll(async () => {
  dir = await createTempDir('assistant-import-work');
  home = path.join(dir, 'home');
  ground = path.join(dir, 'ground');
  skillsRoot = path.join(dir, 'skills');

  // A Claude.ai export, as the zip it downloads as.
  await fs.mkdir(path.join(home, 'Downloads'), { recursive: true });
  await writeZip(path.join(home, 'Downloads', 'data-2026-11-20-batch-0000.zip'), {
    'users.json': JSON.stringify([{ uuid: 'u1', full_name: 'Private Person', email_address: 'person@example.com' }]),
    'memories.json': JSON.stringify([{ conversations_memory: 'Runs a studio. Prefers short answers.', project_memories: { p1: 'The launch slipped to March.' }, account_uuid: 'u1' }]),
    'projects/p1.json': JSON.stringify({ uuid: 'p1', name: 'Launch Plan', description: 'Q1 launch', prompt_template: 'Always cite the brief.', docs: [{ uuid: 'd1', filename: '../../escape.md', content: 'THE BRIEF' }] }),
    'conversations.json': JSON.stringify([{
      uuid: 'c1-aaaa', name: 'Pricing page', created_at: '2026-10-01T09:00:00Z', chat_messages: [
        { sender: 'human', created_at: '2026-10-01T09:00:00Z', text: 'Draft the pricing page', content: [{ type: 'text', text: 'Draft the pricing page' }], attachments: [{ file_name: 'notes.txt', extracted_content: 'tiers: free, pro' }], files: [] },
        { sender: 'assistant', created_at: '2026-10-01T09:01:00Z', content: [{ type: 'thinking', thinking: 'PRIVATE REASONING' }, { type: 'tool_use', name: 'web_search', input: { query: 'pricing pages' } }, { type: 'tool_result', content: [{ type: 'text', text: 'RAW TOOL OUTPUT' }] }, { type: 'text', text: 'Here is a draft.' }], attachments: [], files: [{ file_name: 'mock.png' }] },
      ],
    }, { uuid: 'c2-bbbb', name: '', created_at: '2026-10-02T09:00:00Z', chat_messages: [{ sender: 'human', text: 'Second chat opener', content: [], attachments: [], files: [] }] }]),
  });

  // A ChatGPT export, unpacked to a folder: an edited message leaves a branch beside the visible thread.
  const gpt = path.join(home, 'Desktop', 'chatgpt-export');
  await put(path.join(gpt, 'chat.html'), '<html></html>');
  await put(path.join(gpt, 'user.json'), '{}');
  await put(path.join(gpt, 'conversations.json'), JSON.stringify([{
    conversation_id: 'g1', title: 'Trip plan', create_time: 1767225600, current_node: 'a2', gizmo_id: 'g-p-trip',
    mapping: {
      root: { parent: null, message: null },
      s: { parent: 'root', message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['SYSTEM PROMPT'] } } },
      u1: { parent: 's', message: { author: { role: 'user' }, create_time: 1767225600, content: { content_type: 'text', parts: ['Plan Lisbon'] } } },
      old: { parent: 'u1', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['ABANDONED BRANCH'] } } },
      t: { parent: 'u1', message: { author: { role: 'assistant' }, recipient: 'browser', content: { content_type: 'code', text: 'search("lisbon hotels")' } } },
      a2: { parent: 't', message: { author: { role: 'assistant' }, create_time: 1767225660, content: { content_type: 'text', parts: ['Day one: Alfama.'] } } },
    },
  }]));

  // Claude Code: one project, its memory, more sessions than are carried, a command.
  const cc = path.join(home, '.claude');
  await put(path.join(cc, 'commands', 'ship.md'), 'Run the release.\n');
  const proj = path.join(cc, 'projects', '-work-shop');
  await put(path.join(proj, 'memory', 'MEMORY.md'), '- the shop uses Stripe\n');
  for (let i = 0; i <= SESSIONS_CARRIED; i += 1) {
    const file = path.join(proj, `s${String(i).padStart(2, '0')}.jsonl`);
    await put(file, lines(
      { type: 'user', isMeta: true, cwd: '/work/shop', message: { content: 'META NOISE' } },
      { type: 'user', cwd: '/work/shop', timestamp: '2026-11-01T10:00:00Z', message: { content: `Fix checkout <system-reminder>INJECTED</system-reminder> ${i}` } },
      { type: 'assistant', timestamp: '2026-11-01T10:00:05Z', message: { content: [{ type: 'thinking', thinking: 'PRIVATE' }] } },
      { type: 'assistant', timestamp: '2026-11-01T10:00:06Z', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
      { type: 'user', timestamp: '2026-11-01T10:00:07Z', message: { content: [{ type: 'tool_result', content: 'RAW OUTPUT' }] } },
      { type: 'assistant', timestamp: '2026-11-01T10:00:09Z', message: { content: [{ type: 'text', text: 'Checkout fixed.' }] } },
      { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'SUBAGENT' }] } },
      { type: 'ai-title', aiTitle: `Checkout fix ${i}` },
    ));
    const t = new Date(Date.UTC(2026, 10, 1, 0, i));
    await fs.utimes(file, t, t);
  }

  // Codex: the person's session, and a helper session Codex started itself.
  const cx = path.join(home, '.codex');
  await put(path.join(cx, 'rules', 'default.rules'), 'never push\n');
  await put(path.join(cx, 'session_index.jsonl'), lines({ id: 'x1', thread_name: 'Migrate the db', updated_at: '2026-11-02' }));
  await put(path.join(cx, 'sessions', '2026', '11', '02', 'rollout-2026-11-02T10-00-00-x1.jsonl'), lines(
    { type: 'session_meta', timestamp: '2026-11-02T10:00:00Z', payload: { id: 'x1', cwd: '/work/db' } },
    { type: 'event_msg', timestamp: '2026-11-02T10:00:01Z', payload: { type: 'user_message', message: 'Migrate the users table' } },
    { type: 'response_item', timestamp: '2026-11-02T10:00:02Z', payload: { type: 'custom_tool_call', name: 'exec', input: 'text(await tools.exec_command({cmd:"psql -c \\"\\\\d users\\""}))' } },
    { type: 'event_msg', timestamp: '2026-11-02T10:00:09Z', payload: { type: 'agent_message', message: 'Migration written.' } },
  ));
  await put(path.join(cx, 'sessions', '2026', '11', '02', 'rollout-2026-11-02T10-05-00-x2.jsonl'), lines(
    { type: 'session_meta', payload: { id: 'x2', cwd: '/work/db', parent_thread_id: 'x1' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'The following is the Codex agent history…' } },
  ));

  // Hermes: a session and a scheduled job, the shape its own cron/jobs.py writes.
  const hm = path.join(home, '.hermes');
  await put(path.join(hm, 'sessions', 'session_20260416_015641_aaaaaa.json'), JSON.stringify({ session_id: 'h1', session_start: '2026-04-16T01:56:41', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'Morning brief' }, { role: 'assistant', content: 'Three things today.', reasoning: 'PRIVATE' }] }));
  await put(path.join(hm, 'cron', 'jobs.json'), JSON.stringify({ jobs: [{ id: 'j1', name: 'Weekday brief', prompt: 'Summarise my inbox', skills: ['inbox'], schedule: { kind: 'cron', expr: '0 8 * * 1-5', display: 'weekdays at 08:00' }, schedule_display: 'weekdays at 08:00', enabled: true, last_run_at: '2026-11-21T08:00:00', deliver: 'telegram' }] }));
});

afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe('found on this computer', () => {
  test('agent folders and the exports waiting in Downloads and Desktop, each named for what it is', async () => {
    const found = Object.fromEntries((await findAssistants(home)).map((f) => [f.kind, f]));
    expect(found['claude-export'].root).toBe(path.join(home, 'Downloads', 'data-2026-11-20-batch-0000.zip'));
    expect(found['claude-export'].counts.projects).toBe(1);
    expect(found['chatgpt-export'].root).toBe(path.join(home, 'Desktop', 'chatgpt-export'));
    expect(found['claude-code'].counts).toMatchObject({ projects: 1, conversations: SESSIONS_CARRIED + 1 });
    expect(found.codex.counts.conversations).toBe(2);
    expect(found.hermes.counts).toMatchObject({ conversations: 1, scheduled: 1 });
  });
});

describe('a Claude export, read from its zip', () => {
  let report;
  beforeAll(async () => { report = await land('claude-export', path.join(home, 'Downloads', 'data-2026-11-20-batch-0000.zip')); });

  test('every conversation is a page, and the index names them all', async () => {
    expect(report.conversations).toEqual({ total: 2, carried: 2 });
    const index = await read(path.join(report.dir, 'conversations', 'index.md'));
    expect(index).toContain('| 2026-10-01 | Pricing page | 2 |');
    expect(index).toContain('Second chat opener');
    const page = await read(path.join(report.dir, 'conversations', '2026-10-01-pricing-page-c1-aaaa.md'));
    expect(page).toContain('Draft the pricing page');
    expect(page).toContain('Attached notes.txt:\n\ntiers: free, pro');
    expect(page).toContain('> used web_search: pricing pages');
    expect(page).toContain('(a file was shared here, mock.png; the export does not include its contents)');
    expect(page).not.toContain('PRIVATE REASONING');
    expect(page).not.toContain('RAW TOOL OUTPUT');
  });

  test('its memory is about you; a project keeps its instructions, memory and files', async () => {
    expect(await read(path.join(report.dir, 'about-you', 'claude-memory.md'))).toBe('Runs a studio. Prefers short answers.');
    const readme = await read(path.join(report.dir, 'projects', 'launch-plan', 'README.md'));
    expect(readme).toContain('Always cite the brief.');
    expect(readme).toContain('The launch slipped to March.');
    expect(await read(path.join(report.dir, 'projects', 'launch-plan', 'files', 'escape.md'))).toBe('THE BRIEF');
  });

  test('a file name from the export can never climb out of the import', async () => {
    await expect(fs.lstat(path.join(report.dir, 'projects', 'escape.md'))).rejects.toThrow();
    await expect(fs.lstat(path.join(ground, 'escape.md'))).rejects.toThrow();
  });

  test('account data is not carried', async () => {
    const all = (await fs.readdir(report.dir, { recursive: true })).join('\n');
    expect(all).not.toContain('users.json');
    expect(JSON.stringify(report)).not.toContain('person@example.com');
  });
});

describe('a ChatGPT export, read from its folder', () => {
  test('only the visible thread; system text and abandoned branches left out; a tool is one line', async () => {
    const report = await land('chatgpt-export', path.join(home, 'Desktop', 'chatgpt-export'));
    const page = await read(path.join(report.dir, 'conversations', (await fs.readdir(path.join(report.dir, 'conversations'))).find((f) => f !== 'index.md')));
    expect(page).toMatch(/Plan Lisbon[\s\S]*> used browser: search\("lisbon hotels"\)[\s\S]*Day one: Alfama\./);
    expect(page).not.toContain('ABANDONED BRANCH');
    expect(page).not.toContain('SYSTEM PROMPT');
    expect(page).toContain('project: g-p-trip');
  });
});

describe('Claude Code', () => {
  let report;
  beforeAll(async () => { report = await land('claude-code', path.join(home, '.claude')); });

  test('the newest sessions of a project are pages; the one past the cap is listed, never dropped', async () => {
    expect(report.conversations).toEqual({ total: SESSIONS_CARRIED + 1, carried: SESSIONS_CARRIED });
    const index = await read(path.join(report.dir, 'conversations', 'index.md'));
    expect(index).toContain('1 listed only');
    expect(index).toContain('not carried');
  });

  test('a page holds what was typed and done — without the tool\'s reminders, its side-agents or private reasoning', async () => {
    const page = await read(path.join(report.dir, 'conversations', (await fs.readdir(path.join(report.dir, 'conversations'))).find((f) => f.includes(`checkout-fix-${SESSIONS_CARRIED}`))));
    expect(page).toContain(`# Checkout fix ${SESSIONS_CARRIED}`);
    expect(page).toMatch(/Fix checkout\s+30/);
    expect(page).toContain('> used Bash: npm test\nCheckout fixed.');
    for (const hidden of ['META NOISE', 'INJECTED', 'PRIVATE', 'RAW OUTPUT', 'SUBAGENT']) expect(page).not.toContain(hidden);
  });

  test('the project is named for its folder and keeps its memory; commands come over as instructions', async () => {
    expect(report.projects).toEqual(['shop']);
    expect(await read(path.join(report.dir, 'projects', 'shop', 'files', 'memory', 'MEMORY.md'))).toBe('- the shop uses Stripe\n');
    expect(report.instructions).toEqual(['commands/ship.md']);
  });
});

describe('Codex', () => {
  test('the person\'s session by its title and its command; a helper session Codex started is left out and named', async () => {
    const report = await land('codex', path.join(home, '.codex'));
    expect(report.conversations).toEqual({ total: 1, carried: 1 });
    expect(report.skipped).toEqual([expect.objectContaining({ why: expect.stringMatching(/helper session Codex started itself/) })]);
    const page = await read(path.join(report.dir, 'conversations', (await fs.readdir(path.join(report.dir, 'conversations'))).find((f) => f !== 'index.md')));
    expect(page).toContain('# Migrate the db');
    expect(page).toContain('> used exec: psql -c');
    expect(page).toContain('Migration written.');
    expect(report.instructions).toEqual(['rules/default.rules']);
  });
});

describe('OpenClaw — its own databases, opened read-only', () => {
  // Columns as openclaw 2026.11.6 creates them (its dist/ CREATE TABLE statements), trimmed to what is read.
  const DDL = `
    CREATE TABLE session_nodes (session_key TEXT NOT NULL PRIMARY KEY, current_session_id TEXT NOT NULL, entry_json TEXT NOT NULL, updated_at INTEGER NOT NULL, created_via TEXT);
    CREATE TABLE session_windows (session_id TEXT NOT NULL PRIMARY KEY, session_key TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE transcript_events (session_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT, created_at INTEGER NOT NULL, event_zstd BLOB, event_utf8_bytes INTEGER, message_role TEXT, PRIMARY KEY (session_id, seq));`;
  let ocRoot;
  beforeAll(async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const zlib = await import('node:zlib');
    const state = path.join(home, '.openclaw-db');
    ocRoot = path.join(state, 'workspace');
    await put(path.join(ocRoot, 'USER.md'), 'Name: Sam.\n');
    await fs.mkdir(path.join(state, 'agents', 'main', 'agent'), { recursive: true });
    const db = new DatabaseSync(path.join(state, 'agents', 'main', 'agent', 'openclaw-agent.sqlite'));
    db.exec(DDL);
    db.prepare('INSERT INTO session_nodes VALUES (?, ?, ?, ?, ?)').run('agent:main:main', 'w2', JSON.stringify({ label: 'Book the venue', sessionStartedAt: 1767225600000, updatedAt: 2 }), 2, 'operator');
    db.prepare('INSERT INTO session_nodes VALUES (?, ?, ?, ?, ?)').run('agent:main:sub-1', 'w9', JSON.stringify({ updatedAt: 3 }), 3, 'spawn');
    db.prepare('INSERT INTO session_windows VALUES (?, ?, ?, ?, ?)').run('w1', 'agent:main:main', 'initial', 1, 1);
    db.prepare('INSERT INTO session_windows VALUES (?, ?, ?, ?, ?)').run('w2', 'agent:main:main', 'reset', 2, 2);
    db.prepare('INSERT INTO session_windows VALUES (?, ?, ?, ?, ?)').run('w9', 'agent:main:sub-1', 'initial', 3, 3);
    const ev = db.prepare('INSERT INTO transcript_events (session_id, seq, event_json, created_at, event_zstd, event_utf8_bytes, message_role) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const plain = (w, seq, e) => ev.run(w, seq, JSON.stringify(e), seq, null, null, e.message?.role || null);
    plain('w1', 1, { type: 'session', id: 's', cwd: '/w' });
    plain('w1', 2, { type: 'message', id: 'm1', message: { role: 'user', content: 'Find a venue for 40' } });
    plain('w1', 3, { type: 'message', id: 'm2', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE' }, { type: 'toolCall', id: 't1', name: 'web_search', arguments: { query: 'venues 40 people' } }] } });
    plain('w1', 4, { type: 'message', id: 'm3', message: { role: 'toolResult', content: [{ type: 'text', text: 'RAW RESULT' }] } });
    plain('w1', 5, { type: 'message', id: 'm4', message: { role: 'assistant', content: [{ type: 'text', text: 'FIRST DRAFT' }] } });
    plain('w1', 6, { type: 'message', id: 'm4b', supersedesEntryId: 'm4', message: { role: 'assistant', content: [{ type: 'text', text: 'Three venues fit.' }] } });
    const packed = JSON.stringify({ type: 'message', id: 'm5', message: { role: 'user', content: [{ type: 'text', text: 'Book the second one' }] } });
    ev.run('w2', 1, null, 10, zlib.zstdCompressSync(Buffer.from(packed)), Buffer.byteLength(packed), 'user');
    plain('w9', 1, { type: 'message', id: 'h1', message: { role: 'user', content: 'HELPER TASK' } });
    db.close();
    await fs.mkdir(path.join(state, 'state'), { recursive: true });
    const st = new DatabaseSync(path.join(state, 'state', 'openclaw.sqlite'));
    st.exec('CREATE TABLE cron_jobs (store_key TEXT NOT NULL, job_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL, agent_id TEXT, payload_kind TEXT NOT NULL, job_json TEXT NOT NULL, state_json TEXT NOT NULL DEFAULT \'{}\', updated_at INTEGER NOT NULL, PRIMARY KEY (store_key, job_id))');
    const job = st.prepare('INSERT INTO cron_jobs (store_key, job_id, name, enabled, agent_id, payload_kind, job_json, state_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    job.run('default', 'j1', 'Morning digest', 1, 'main', 'agentTurn', JSON.stringify({ schedule: { kind: 'cron', expr: '0 7 * * *', tz: 'Asia/Jakarta' }, payload: { kind: 'agentTurn', message: 'Digest my channels' } }), JSON.stringify({ lastRunAtMs: 1767225600000 }), 1);
    job.run('default', 'j2', 'Another agent\'s job', 1, 'work', 'agentTurn', JSON.stringify({ schedule: { kind: 'every', everyMs: 3_600_000 }, payload: { message: 'NOT MAIN' } }), '{}', 1);
    st.close();
  });

  test('a conversation across its resets, rewritten messages as their latest copy, a packed event read', async () => {
    const report = await land('openclaw', ocRoot);
    expect(report.conversations).toEqual({ total: 1, carried: 1 });
    const page = await read(path.join(report.dir, 'conversations', (await fs.readdir(path.join(report.dir, 'conversations'))).find((f) => f !== 'index.md')));
    expect(page).toContain('# Book the venue');
    expect(page).toMatch(/Find a venue for 40[\s\S]*> used web_search: venues 40 people\nThree venues fit\.[\s\S]*Book the second one/);
    for (const hidden of ['FIRST DRAFT', 'RAW RESULT', 'PRIVATE', 'HELPER TASK']) expect(page).not.toContain(hidden);
    expect(report.skipped).toEqual([{ file: 'agent:main:sub-1', why: 'a session OpenClaw opened for itself (spawn)' }]);
  });

  test('its scheduled job for this agent is listed, with its schedule and what it asks', async () => {
    const report = await land('openclaw', ocRoot);
    expect(report.scheduled).toEqual(['Morning digest']);
    const jobs = await read(path.join(report.dir, 'scheduled.md'));
    expect(jobs).toContain('- When: cron 0 7 * * * (Asia/Jakarta)');
    expect(jobs).toContain('Digest my channels');
    expect(jobs).not.toContain('NOT MAIN');
  });

  test('a layout it does not know is said so, never guessed at', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const state = path.join(home, '.openclaw-future');
    await put(path.join(state, 'workspace', 'USER.md'), 'Name: Sam.\n');
    await fs.mkdir(path.join(state, 'agents', 'main', 'agent'), { recursive: true });
    const db = new DatabaseSync(path.join(state, 'agents', 'main', 'agent', 'openclaw-agent.sqlite'));
    db.exec('CREATE TABLE session_nodes (session_key TEXT, entry_json TEXT); CREATE TABLE session_windows (session_id TEXT, session_key TEXT, created_at INTEGER); CREATE TABLE transcript_events (session_id TEXT, seq INTEGER, payload BLOB);');
    db.close();
    const read2 = await readAssistant('openclaw', path.join(state, 'workspace'));
    expect(read2.skipped).toEqual([expect.objectContaining({ why: 'this OpenClaw keeps its conversations in a layout this import does not read yet' })]);
    expect(read2.aboutYou).toHaveLength(1);
  });
});

describe('Hermes', () => {
  test('its session is a page and its scheduled job is listed — never started here', async () => {
    const report = await land('hermes', path.join(home, '.hermes'));
    expect(report.conversations).toEqual({ total: 1, carried: 1 });
    expect(report.scheduled).toEqual(['Weekday brief']);
    const jobs = await read(path.join(report.dir, 'scheduled.md'));
    expect(jobs).toContain('None of these runs here.');
    expect(jobs).toContain('- When: weekdays at 08:00');
    expect(jobs).toContain('Summarise my inbox');
    const page = await read(path.join(report.dir, 'conversations', (await fs.readdir(path.join(report.dir, 'conversations'))).find((f) => f !== 'index.md')));
    expect(page).not.toContain('PRIVATE');
    expect(page).not.toContain('SYS');
  });
});
