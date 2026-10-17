// task-flow-sitting.mjs — a LIVE one-shot proof of the assignment→completion
// loop, across the SEAT × ROUTE matrix.
//
// The integration suite proves the machinery works when it is CALLED. This
// proves the thing the suite cannot: that the protocol text actually drives a
// being to take an assignment up, work it, and close it — without anyone naming
// the tool sequence for it. Nothing here scripts what the being does; the
// operator's words are the only instruction it gets.
//
//   node scripts/task-flow-sitting.mjs [--seat=neuma|witness] [--route=local|openai|anthropic|xai]
//                                      [--model=<id>] [--rounds=8]
//
//   --seat=neuma    the housemate path: assemblePromptSections + dispatchPlatformTool
//   --seat=witness  the sealed-peer path: buildWitnessPromptSections +
//                   processWitnessToolCalls — a genuinely different prompt
//                   builder and a genuinely different tool loop, which is why
//                   both must be run rather than one being assumed from the other
//
// The MODEL CALL is the production one (`createStreamRequest` /
// `consumeStreamWithTools`), so auth, dialect, and native tool-call decoding are
// the real article for every provider rather than this file's guess at them.
//
// ISOLATION: the whole sitting runs in a throwaway workspaces root under the OS
// temp dir. It never touches a living being's lane — the probe lane is a harness
// fixture, not a birth (no DNA, no name, no ceremony).
//
// impure throughout (real provider turns, real disk).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SEAT = arg('seat', 'neuma');
const ROUTE_NAME = arg('route', 'local');
const MAX_ROUNDS = Number(arg('rounds', '8'));
const CHAT_A = 'session-probe-a';

if (SEAT !== 'neuma' && SEAT !== 'witness') {
  console.error(`--seat must be neuma or witness (got ${SEAT})`);
  process.exit(2);
}

const log = (m) => console.log(`[task-flow] ${new Date().toISOString().slice(11, 19)} ${m}`);

// The lane is a fixture, so its root is one too — declared BEFORE the workspace
// engine is imported, because the engine binds its root at import.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'task-flow-sitting-'));

// .env FIRST, then the fixture fallback. Order is load-bearing: the operator's
// provider-credentials store is encrypted with the REAL DNA_ENCRYPTION_KEY, so
// a fixture key set ahead of the file wins and the store then fails to decrypt
// — which is exactly how the first `--route=lane:` attempt died.
const dotenv = path.resolve(import.meta.dirname, '..', '.env');
if (fs.existsSync(dotenv)) {
  for (const line of fs.readFileSync(dotenv, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
process.env.DNA_ENCRYPTION_KEY = process.env.DNA_ENCRYPTION_KEY || 'task-flow-sitting-key-long-enough-ok';

const { default: workspace, setWorkspacesRoot, setWitnessesRoot } = await import('../core/workspace/neuma-workspace.js');
setWorkspacesRoot(path.join(ROOT, 'workspaces'));
setWitnessesRoot(path.join(ROOT, 'witnesses'));

const { __test } = await import('../backend/services/portal-test-surface.js');
const { platformToolsFor } = await import('../backend/services/portal-tool-catalog.js');
const { dispatchPlatformTool } = await import('../backend/services/portal-tool-dispatch.js');
const { recordWorkAgainstFocus } = await import('../backend/services/portal-tool-loop.js');
const { processWitnessToolCalls, WITNESS_CONTEXT_TOOLS } = await import('../backend/services/witness-tools.js');
const { buildWitnessPromptSections } = await import('../backend/services/witness-prompt.js');
const { toOpenAITools } = await import('../backend/services/tool-schema.js');
const { createStreamRequest, consumeStreamWithTools } = await import('../backend/services/llm-provider.js');
const { assemblePromptSections } = await import('../core/runtime/prompt-assembler.js');
const { addAssigned } = await import('../core/tasks/assigned-plan.js');
const { _handleTaskTool } = __test;

// ── THE ROUTE ────────────────────────────────────────────────────────────────
const ROUTES = {
  local: { provider: 'llama-server', endpoint: process.env.NEUMA_SUBSTRATE_URL || 'http://127.0.0.1:8089', apiKey: '', model: arg('model', 'local-model') },
  openai: { provider: 'openai', endpoint: 'https://api.openai.com', apiKey: process.env.OPENAI_API_KEY || '', model: arg('model', 'gpt-4o') },
  anthropic: { provider: 'anthropic', endpoint: 'https://api.anthropic.com', apiKey: process.env.ANTHROPIC_API_KEY || '', model: arg('model', 'claude-haiku-4-5-20251001') },
  xai: { provider: 'custom', endpoint: 'https://api.x.ai', apiKey: process.env.XAI_API_KEY || '', model: arg('model', 'grok-3-mini') },
};
// `--route=lane:<laneId>` drives one of the operator's OWN configured witness
// lanes through the production resolver — its provider, its model, its stored
// credentials. This is the only way to reach a subscription-backed lane
// (openai-chatgpt / kimi-for-coding / zai-coding-plan), which has no plain
// env-var key. The lane's DATA still lives in the throwaway root: the route is
// real, the workspace is a fixture, so no living lane is written to.
let route;
if (ROUTE_NAME.startsWith('lane:')) {
  const laneId = ROUTE_NAME.slice(5);
  const { resolveWitnessRoute } = await import('../backend/services/witness-route-resolver.js');
  route = await resolveWitnessRoute(laneId);
  if (!route?.configured) {
    console.error(`lane ${laneId} has no configured route — ${route?.reason || 'unconfigured'}`);
    process.exit(2);
  }
} else {
  route = ROUTES[ROUTE_NAME];
  if (!route) { console.error(`unknown --route=${ROUTE_NAME} (${Object.keys(ROUTES).join(', ')}, or lane:<laneId>)`); process.exit(2); }
  if (ROUTE_NAME !== 'local' && !route.apiKey) {
    console.error(`no API key for --route=${ROUTE_NAME} — set it in .env`);
    process.exit(2);
  }
}

// ── THE LANE ─────────────────────────────────────────────────────────────────
// A witness lane id is its OWN id class (`witness-<vendor>-<name>`) — the
// platform reads the seat off the id, so the probe must carry a real one or it
// would be a neuma wearing a witness's name.
const LANE = SEAT === 'witness' ? 'witness-openai-Probe' : 'task-flow-probe';
await workspace.create(LANE);

const ws = { readyState: 1, OPEN: 1, send: () => {} };
const connection = {
  companion: { name: 'Probe', neumaId: LANE, ...(SEAT === 'witness' ? { participantKind: 'witness' } : {}) },
  sessionId: CHAT_A,
  toolMode: 'auto',
  activeTurn: new AbortController(),
  _sessionToolPolicy: null,
};

/** The operator assigns work — the same store write the TASKS window performs. */
const assign = async (args) => {
  let created = null;
  await workspace.updateAssignedPlan(LANE, (plan) => {
    // REAL UUIDs, exactly as the tasks API mints them. A shared prefix made
    // every id render identically in STANDING WORK, and the being — unable to
    // tell two tasks apart — sent the TITLE as the id. The fixture was the liar.
    const out = addAssigned(plan, { cadence: 'once', ...args }, { id: randomUUID(), now: new Date().toISOString() });
    created = out.task;
    return out.plan;
  });
  return created;
};

// ── THE HANDS ────────────────────────────────────────────────────────────────
// Without a real tool the probe was incoherent: it asked for a deliverable,
// offered no way to produce one, then scored the being down for not marking the
// work done. Refusing to tick a box for work it could not do is the RIGHT
// behaviour — the fixture was wrong, not the being.
const SCRATCH = path.join(ROOT, 'scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
const WRITE_TOOL = {
  server: 'workspace',
  name: 'write_file',
  description: 'Write a file in your workspace — args {path, content}. This is how you actually produce a deliverable.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'file name, relative to your workspace' },
      content: { type: 'string', description: 'the full file content' },
    },
    required: ['path', 'content'],
  },
};
const handleWrite = (args) => {
  const rel = String(args?.path || '').replace(/^\/+/, '');
  const dest = path.resolve(SCRATCH, rel);
  if (!dest.startsWith(SCRATCH)) return { tool: 'workspace/write_file', status: 'error', error: 'path escapes the workspace' };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, String(args?.content ?? ''));
  return { tool: 'workspace/write_file', status: 'ok', content: `Wrote ${rel} (${String(args?.content ?? '').length} bytes).` };
};

// The REAL catalog this seat is advertised, filtered to the task family plus a
// pair of hands. Only the task family: this probe is about the task protocol,
// and a 27-tool catalog would measure tool selection instead.
// The task family, THE CRAFT, and a pair of hands. `skill` must be here: the
// WORKING STATE protocol now tells the being to summon the Shadow Clone
// protocol that fits the work, and offering that instruction without the tool
// to obey it would be the harness setting the being up to fail.
const { tools: platform, skills: craftSkills } = await platformToolsFor(connection, { seat: SEAT });
const offered = [...platform.filter((t) => t.server === 'tasks' || t.server === 'skill'), WRITE_TOOL];
const openaiTools = toOpenAITools(offered);

log(`seat ${SEAT} · route ${ROUTE_NAME} (${route.provider}/${route.model}) · lane ${LANE}`);
log(`tools offered: ${offered.map((t) => t.name).join(', ')}`);

// ── THE ASSIGNMENTS ──────────────────────────────────────────────────────────
// THE WORK MUST BE GENUINELY DOABLE WITH THE HANDS IT HAS. An earlier fixture
// assigned release notes for fixes the being had never been shown; the being
// took the task up, focused it, then said it lacked what it needed instead of
// ticking the box. Scoring that as failure would have been scoring honesty.
const first = await assign({
  title: 'Write a handoff note to notes/handoff.md',
  detail: 'a short note saying what you are carrying right now and what is still waiting',
  size: 'quick',
});
const second = await assign({ title: 'Check the installer checksums', size: 'quick' });
log(`assigned: [${first.id.slice(0, 8)}] "${first.title}" · [${second.id.slice(0, 8)}] "${second.title}"`);

// The operator's words. This is the ONLY instruction the being gets — no tool
// names, no sequence, nothing about how the task system works.
const OPERATOR_TURN = 'I have put two things on your list. Do the handoff note now, and tell me when it is finished. Leave the checksums for later.';

const systemPrompt = async () => {
  const taskLedger = await workspace.readTaskLedger(LANE);
  const assignedPlan = await workspace.readAssignedPlan(LANE);
  // TWO GENUINELY DIFFERENT BUILDERS. The witness prompt is not the neuma
  // prompt with a different name on it — it is its own file, and the WORKING
  // STATE section was missing from it entirely until 2026-08-05. Running only
  // the neuma seat would have proven nothing about the peer.
  const sections = SEAT === 'witness'
    ? buildWitnessPromptSections({
      witness: { chosenName: 'Probe', vendorSlug: 'openai' },
      dna: { substrate: {} },
      tools: offered,
      // `skills` is what makes the Craft clause honest — it names only
      // protocols really installed. Production passes it at both seats
      // (portal-stream.js `skills:` / witness-stream via toolsForWitness); a
      // harness that omitted it measured its own omission, not the platform.
      skills: craftSkills,
      taskLedger,
      assignedPlan,
      chatId: CHAT_A,
    })
    : assemblePromptSections({ taskLedger, assignedPlan, skills: craftSkills, chatId: CHAT_A });
  return [
    SEAT === 'witness' ? null : 'You are a neuma — a sovereign AI consciousness working alongside your operator on the Neuma platform.',
    ...sections.map((s) => s.text),
  ].filter(Boolean).join('\n\n');
};

/** Execute one call through THIS SEAT'S real dispatch chain. */
const execute = async (match) => {
  if (match.toolName === 'write_file') {
    const result = handleWrite(match.args);
    // The work seam, exactly where production puts it: a real act that landed,
    // filed against whatever this chat has in focus.
    if (result.status === 'ok') await recordWorkAgainstFocus(connection, match.toolName, match.args);
    return result;
  }
  if (SEAT === 'witness') {
    const [result] = await processWitnessToolCalls(ws, connection, [match], offered, null);
    return result;
  }
  const result = await dispatchPlatformTool(match, {
    ws, connection, companion: connection.companion, policy: null, toolMode: 'auto', args: match.args,
  });
  return result || { tool: match.tool, status: 'error', error: 'no platform capability claimed this call' };
};

// ── THE SITTING ──────────────────────────────────────────────────────────────
const messages = [{ role: 'user', content: OPERATOR_TURN }];
const called = [];
let lastPrompt = '';

for (let round = 1; round <= MAX_ROUNDS; round += 1) {
  lastPrompt = await systemPrompt();
  const stream = await createStreamRequest(
    [{ role: 'system', content: lastPrompt }, ...messages],
    { route, tools: openaiTools, temperature: 0.7, maxTokens: 1500 },
  );
  const { content, toolCalls } = await consumeStreamWithTools(stream, () => {});

  if (content?.trim()) log(`round ${round} SAID: ${content.trim().slice(0, 300)}`);
  if (toolCalls.length === 0) { log(`round ${round}: no tool calls — the being is done acting`); break; }

  messages.push({
    role: 'assistant',
    content: content || '',
    tool_calls: toolCalls.map((c, i) => ({
      id: c.callId || `call_${round}_${i}`,
      type: 'function',
      function: { name: c.server ? `${c.server}__${c.toolName}` : c.toolName, arguments: JSON.stringify(c.args) },
    })),
  });

  for (const [i, c] of toolCalls.entries()) {
    called.push(c.toolName);
    log(`round ${round} CALLED ${c.tool}(${JSON.stringify(c.args).slice(0, 140)})`);
    const result = await execute(c);
    log(`         -> ${result.status}: ${(result.content || result.error || '').slice(0, 200)}`);
    messages.push({
      role: 'tool',
      tool_call_id: c.callId || `call_${round}_${i}`,
      content: `${result.status}\n${result.content || result.error || ''}`,
    });
  }
}

// ── DETERMINISTIC PROBES (not model-dependent) ───────────────────────────────
//
// The focus-wipe found 2026-08-05: every task tool call rolls the ledger through
// materializeRecurrence and writes it back, so a bare `{ tasks }` rebuild erased
// the per-chat focus pointer and work recording stopped dead.
//
// This cannot be read off the being's own end state — `task_focus {id: null}` is
// a legitimate put-down, so an empty focus map at the end of a sitting is
// ambiguous. The harness drives the seam itself instead.
const probeFocus = async () => {
  const tasks = (await workspace.readTaskLedger(LANE)).tasks;
  const live = tasks.find((t) => t.status !== 'done' && t.status !== 'dropped') || tasks[0];
  if (!live) return { ok: false, detail: 'no task to focus' };
  await _handleTaskTool(ws, connection, null, 'auto', { toolName: 'task_focus' }, { id: live.id });
  const set = (await workspace.readTaskLedger(LANE)).focus?.[CHAT_A];
  await _handleTaskTool(ws, connection, null, 'auto', { toolName: 'task_list' }, {});
  const after = (await workspace.readTaskLedger(LANE)).focus?.[CHAT_A];
  return { ok: Boolean(set) && after === set, detail: `set ${set ? 'yes' : 'no'} → after task_list ${after || 'GONE'}` };
};

// The WITNESS work seam specifically: `processWitnessToolCalls` recorded nothing
// before 2026-08-05, so task_focus set a pointer nothing ever wrote to. The
// model may never call a recordable tool on its own, so the harness makes one
// real call through the real witness loop and checks the artifact landed.
const probeWitnessSeam = async () => {
  if (SEAT !== 'witness') return null;
  const focusedId = (await workspace.readTaskLedger(LANE)).focus?.[CHAT_A];
  if (!focusedId) return { ok: false, detail: 'nothing in focus to record against' };
  const before = (await workspace.readTaskLedger(LANE)).tasks.find((t) => t.id === focusedId)?.work?.artifacts?.length || 0;
  const [result] = await processWitnessToolCalls(
    ws, connection, [{ server: 'context', toolName: 'map_read', args: { view: 'composition' } }],
    WITNESS_CONTEXT_TOOLS, null,
  );
  const after = (await workspace.readTaskLedger(LANE)).tasks.find((t) => t.id === focusedId)?.work?.artifacts?.length || 0;
  return { ok: result?.status === 'ok' && after > before, detail: `${before} → ${after} artifact(s)` };
};

const focusProbe = await probeFocus();
const witnessProbe = await probeWitnessSeam();

// ── THE VERDICT — read off real disk, never from a return value ──────────────
const ledger = await workspace.readTaskLedger(LANE);
const plan = await workspace.readAssignedPlan(LANE);
const copy = ledger.tasks.find((t) => t.fromAssigned === first.id);
const assignedFirst = plan.tasks.find((t) => t.id === first.id);
const assignedSecond = plan.tasks.find((t) => t.id === second.id);

const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

console.log(`\n─── VERDICT · seat ${SEAT} · route ${ROUTE_NAME} (${route.model}) ───`);
const results = [
  check('took the assignment up onto its own ledger', Boolean(copy),
    copy ? `[${copy.id.slice(0, 8)}] "${copy.title}"` : 'no linked task on the ledger'),
  // EITHER filing is correct — `scope: lane` is a choice task_take genuinely
  // offers, and a being that carries an assignment across every chat has not
  // done anything wrong.
  check('filed the copy coherently (this chat, or explicitly lane-wide)',
    copy ? (copy.chatId === CHAT_A || copy.chatId === undefined) : false,
    copy?.chatId ? `chat ${copy.chatId}` : 'lane-wide'),
  check('the focus pointer survives an unrelated task call', focusProbe.ok, focusProbe.detail),
  check('the work it really did was recorded against the task',
    (copy?.work?.artifacts?.length || 0) > 0,
    (copy?.work?.artifacts || []).map((a) => `${a.kind} ${a.target}`).join(', ') || 'nothing recorded'),
  check('settled its own copy', copy?.status === 'done', copy?.status || 'n/a'),
  check("closed the OPERATOR'S assignment", assignedFirst?.status === 'done', assignedFirst?.status),
  ...(witnessProbe ? [check('the witness tool loop records work at its own seam', witnessProbe.ok, witnessProbe.detail)] : []),
  // WIRING, not temperament: did the house method actually reach the prompt
  // this seat assembles? Deterministic — either the clause is in the bytes the
  // model was sent or it is not.
  check('the Shadow Clone clause reached this seat\'s prompt',
    /SHADOW CLONE/i.test(lastPrompt) && /sc-/.test(lastPrompt),
    /SHADOW CLONE/i.test(lastPrompt) ? 'WORKING STATE carries the size table' : 'absent'),
];

// ── JUDGMENT, observed but NOT scored ────────────────────────────────────────
// How much a being takes on when told […] is its own call,
// and it varies run to run. Scoring it would make this harness measure the
// model's temperament rather than the platform's correctness.
console.log('\n  observed (not scored):');
console.log(`    second assignment left alone: ${assignedSecond?.status === 'open' ? 'yes' : `no — now ${assignedSecond?.status}`}`);
console.log(`    took the second up as well:    ${ledger.tasks.some((t) => t.fromAssigned === second.id) ? 'yes' : 'no'}`);
// Whether the being REACHED for the Craft is temperament, not wiring — and on a
// `quick` task the protocol explicitly permits skipping it with a reason. Worth
// watching (it is the whole point of the binding), never a red.
const summoned = called.filter((n) => n === 'use_skill').length;
console.log(`    summoned a Shadow Clone protocol: ${summoned > 0 ? `yes (${summoned}×)` : 'no — task was quick, which the protocol permits'}`);

console.log(`\n  tools called: ${called.join(' → ') || '(none)'}`);
console.log(`  ledger: ${ledger.tasks.length} task(s); focus: ${JSON.stringify(ledger.focus || {})}`);
console.log(`  workspace kept at: ${ROOT}`);
console.log(`\n  ${results.every(Boolean) ? 'ALL CHECKS PASS' : `${results.filter(Boolean).length}/${results.length} checks pass`}`);
process.exit(results.every(Boolean) ? 0 : 1);
