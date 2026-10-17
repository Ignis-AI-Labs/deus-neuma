/**
 * THE CRAFT AT THE WITNESS SEAT (RULE 0) — Design note, 2026-07-26: […]
 *
 * Real filesystem throughout: a real shadow-clone-shaped plugin installed by
 * the real installer into a real temp skills root, scanned by the real
 * registry, advertised by the real `toolsForWitness`, summoned through the real
 * `processWitnessToolCalls` over a real WebSocket pair, with honest acquisition
 * landing in a real witness lane on disk. Nothing here is stubbed — the skills
 * root, the registry, the policy resolution, the socket, and the workspace
 * writes are all the production article.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installPlugin } from '../../core/skills/plugin-install.js';

const LANE_ID = 'witness-openai-chatgpt-Craft';

// A body deliberately past the witness runtime's flat 12000-char result limit:
// the real `sc-plan` is 17559 chars, and before this work the witness formatter
// ignored a result's own cap and cut a summoned protocol off mid-step.
const LONG_BODY = `## Planning mode

You are in planning mode. Decompose the goal into ordered waves.
${'Rule: never skip the audit wave. '.repeat(500)}
FINAL LINE: the audit wave closes the plan.`;

let root;
let skillsRoot;
let server;
let wss;
let serverWs;
let client;
let connection;
let frames;
let runtime;

/**
 * Load the witness runtime against a temp skills root. The skill service is a
 * singleton bound at import time, so the root must be declared BEFORE the graph
 * is imported — this is the same real-module, env-scoped isolation the neuma
 * skill tests use, not a mock of the service.
 */
const loadWitnessRuntime = async (witnessesRoot) => {
  vi.resetModules();
  process.env.NEUMA_SKILLS_ROOT = skillsRoot;
  const tools = await import('../../backend/services/witness-tools.js');
  const prompt = await import('../../backend/services/witness-prompt.js');
  const craft = await import('../../core/runtime/skills-section.js');
  const workspace = await import('../../core/workspace/neuma-workspace.js');
  workspace.setWitnessesRoot(witnessesRoot);
  return { tools, prompt, craft, neumaWorkspace: workspace.default };
};

const writeShadowClonePlugin = async (dir) => {
  await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true });
  await fs.writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'shadow-clone', description: 'AI orchestration as commands', version: '0.2.3',
  }));
  await fs.mkdir(path.join(dir, 'commands'), { recursive: true });
  await fs.writeFile(path.join(dir, 'commands', 'sc-plan.md'),
    `---\ndescription: Plan a feature as ordered waves of work\n---\n\n${LONG_BODY}\n`);
  await fs.writeFile(path.join(dir, 'commands', 'sc-echo.md'),
    '---\ndescription: "Paired review: dispatch a second model"\n---\nReview loop body.\n');
  return dir;
};

const skillCall = (name) => [{
  server: 'skill', toolName: 'use_skill', tool: 'skill/use_skill', args: { name },
}];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-craft-'));
  skillsRoot = path.join(root, 'skills');
  await fs.mkdir(skillsRoot, { recursive: true });
  await installPlugin(await writeShadowClonePlugin(path.join(root, 'plugin')), skillsRoot);

  runtime = await loadWitnessRuntime(path.join(root, 'witnesses'));
  await runtime.neumaWorkspace.create(LANE_ID);

  server = http.createServer();
  wss = new WebSocketServer({ server });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const linked = new Promise((resolve) => {
    wss.once('connection', (socket) => { serverWs = socket; resolve(); });
  });
  client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const opened = new Promise((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  frames = [];
  client.on('message', (data) => frames.push(JSON.parse(data.toString())));
  await Promise.all([linked, opened]);

  connection = {
    ws: serverWs,
    walletAddress: '0xwitness',
    toolMode: 'ask',
    activeTurn: new AbortController(),
    companion: { name: 'Kagipem', neumaId: LANE_ID },
  };
});

afterEach(async () => {
  if (client?.readyState === WebSocket.OPEN) client.terminate();
  if (serverWs?.readyState === WebSocket.OPEN) serverWs.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  const workspace = await import('../../core/workspace/neuma-workspace.js');
  workspace.setWitnessesRoot(null);
  delete process.env.NEUMA_SKILLS_ROOT;
  await fs.rm(root, { recursive: true, force: true });
});

// A frame settles a microtask after the call returns; give the socket a beat.
const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('a sealed witness reaches The Craft', () => {
  test('the summoning tool is advertised, allowed, and carries the real menu', async () => {
    const reach = await runtime.tools.toolsForWitness(connection, null);

    const useSkill = reach.tools.find((t) => t.server === 'skill' && t.name === 'use_skill');
    expect(useSkill).toBeDefined();
    // Allowed, not approval_required — reading one's own manual is not an act
    // on the world. A missing policy default would have made this ask a human
    // every single summons, which a neuma never does.
    expect(useSkill.access).toBe('allowed');

    expect(reach.skills.map((s) => s.name).sort()).toEqual(['sc-echo', 'sc-plan']);
  });

  test('an empty skills root advertises no summoning tool at all', async () => {
    const emptyRoot = path.join(root, 'empty-skills');
    await fs.mkdir(emptyRoot, { recursive: true });
    skillsRoot = emptyRoot;
    const bare = await loadWitnessRuntime(path.join(root, 'witnesses'));

    const reach = await bare.tools.toolsForWitness(connection, null);
    expect(reach.skills).toEqual([]);
    expect(reach.tools.some((t) => t.server === 'skill')).toBe(false);
  });

  test('summoning returns the full instructions and records acquisition in the witness OWN lane', async () => {
    const reach = await runtime.tools.toolsForWitness(connection, null);
    const results = await runtime.tools.processWitnessToolCalls(
      serverWs, connection, skillCall('sc-plan'), reach.tools, null,
    );

    expect(results[0].status).toBe('ok');
    expect(results[0].tool).toBe('skill/use_skill');
    expect(results[0].content).toContain('<skill_instructions>');
    expect(results[0].content).toContain('never skip the audit wave');
    expect(results[0].content).toContain('FINAL LINE: the audit wave closes the plan.');
    expect(results[0].cap).toBe(20000);

    // Honest acquisition: used ⇒ acquired, in the witness's own sovereign lane
    // (a witness lane is a workspace through the same engine as a neuma's).
    const tree = await runtime.neumaWorkspace.readSkillTree(LANE_ID);
    expect(tree.acquisitions.map((a) => a.skill)).toContain('sc-plan');

    await settled();
    const chip = frames.find((f) => f.type === 'tool:usage' && f.tool === 'skill/sc-plan');
    expect(chip).toMatchObject({ status: 'ok', companion: 'Kagipem', neumaId: LANE_ID });
  });

  test('the summoned protocol survives the wire uncut — the result cap is honored', async () => {
    const reach = await runtime.tools.toolsForWitness(connection, null);
    const [result] = await runtime.tools.processWitnessToolCalls(
      serverWs, connection, skillCall('sc-plan'), reach.tools, null,
    );

    // The regression this guards: a flat 12000 limit cuts the protocol here.
    expect(result.content.length).toBeGreaterThan(12000);
    const wire = runtime.tools.formatWitnessToolResult(result);
    expect(wire).not.toContain('[tool result truncated]');
    expect(wire).toContain('</skill_instructions>');
    expect(wire).toContain('FINAL LINE: the audit wave closes the plan.');
  });

  test('an unknown name answers with the real library instead of failing', async () => {
    const reach = await runtime.tools.toolsForWitness(connection, null);
    const [result] = await runtime.tools.processWitnessToolCalls(
      serverWs, connection, skillCall('sc-nonexistent'), reach.tools, null,
    );

    expect(result.status).toBe('ok');
    expect(result.content).toContain("No skill named 'sc-nonexistent'");
    expect(result.content).toContain('sc-plan');

    await settled();
    expect(frames.find((f) => f.type === 'tool:usage' && f.status === 'unavailable')).toBeTruthy();
  });

  test('observe mode holds the summons and says which gate closed', async () => {
    const reach = await runtime.tools.toolsForWitness(connection, null);
    connection.toolMode = 'observe';
    const [result] = await runtime.tools.processWitnessToolCalls(
      serverWs, connection, skillCall('sc-plan'), reach.tools, null,
    );

    expect(result).toMatchObject({ tool: 'skill/use_skill', status: 'denied' });
    expect(result.error).toContain('observe mode');
    // Held means held: nothing was learned while the operator was watching.
    const tree = await runtime.neumaWorkspace.readSkillTree(LANE_ID);
    expect(tree.acquisitions || []).toEqual([]);
  });

  test('the witness prompt carries the SAME menu wording a neuma reads', async () => {
    const reach = await runtime.tools.toolsForWitness(connection, null);
    const sections = runtime.prompt.buildWitnessPromptSections({
      witness: { chosenName: 'Kagipem', vendorSlug: 'openai-chatgpt' },
      dna: { substrate: { fullModelId: 'gpt-5' } },
      tools: reach.tools,
      skills: reach.skills,
    });

    const skillsSection = sections.find((s) => s.id === 'skills');
    expect(skillsSection).toBeDefined();
    // Byte-identical to the neuma's: one library, one wording, one craft.
    expect(skillsSection.text).toBe(runtime.craft.buildSkillsSection(reach.skills));
    // Load on demand (2026-10-04): the pointer names the library, never its contents.
    expect(skillsSection.text).toContain('skill/skill_search');
    expect(skillsSection.text).not.toContain('sc-plan: Plan a feature');

    // …and it sits right after the tools that carry the summoning call.
    const ids = sections.map((s) => s.id);
    expect(ids.indexOf('skills')).toBe(ids.indexOf('tools') + 1);
  });

  test('a seat with no skills installed carries no craft section at all', async () => {
    // An empty root must add nothing — an explicit [] and an omitted argument
    // both render the same prompt. (This once asserted byte-identity with the
    // pre-Craft prompt; the always-on PRESENT MOMENT clock landed after it, so
    // the claim is now the narrower and still load-bearing one.)
    const seat = { witness: { chosenName: 'Kagipem', vendorSlug: 'openai-chatgpt' }, dna: {} };
    const pinned = new Date(Date.UTC(2026, 6, 26, 15, 51));
    const explicit = runtime.prompt.buildWitnessPromptSections({ ...seat, skills: [], now: pinned });
    const omitted = runtime.prompt.buildWitnessPromptSections({ ...seat, now: pinned });

    expect(explicit.map((s) => s.id)).not.toContain('skills');
    expect(explicit.map((s) => s.text).join('\n\n')).toBe(omitted.map((s) => s.text).join('\n\n'));
  });

  test('the seat is told what time it is, in UTC, with its offset', async () => {
    // Kagipem, 2026-07-26: […] Before this the witness prompt had no clock
    // of any kind.
    const sections = runtime.prompt.buildWitnessPromptSections({
      witness: { chosenName: 'Kagipem', vendorSlug: 'openai-chatgpt' },
      dna: {},
      now: new Date(Date.UTC(2026, 6, 26, 15, 51)),
    });
    const present = sections.find((s) => s.id === 'present');
    expect(present).toBeDefined();
    expect(present.text).toContain('UTC 2026-07-26T15:51Z');
    expect(present.text).toMatch(/\(UTC[+-]\d{2}:\d{2}\)/);
    expect(present.text).toContain('Never infer today\'s date.');
    // It stands second — a peer learns WHEN it is before it reads anything
    // it might act on.
    expect(sections.map((s) => s.id).indexOf('present')).toBe(1);
  });
});

describe('a sealed witness sees ITS OWN wallet and no other', () => {
  let _handleWalletView;
  beforeEach(async () => {
    ({ __test: { _handleWalletView } } = await import('../../backend/services/portal-test-surface.js'));
  });
  // Design note, 2026-07-26: […]
  

  test('the view tool is advertised at the seat; the send tool never is', async () => {
    const reach = await runtime.tools.toolsForWitness(connection, null);
    const wallet = reach.tools.filter((t) => t.server === 'wallet');
    expect(wallet.map((t) => t.name)).toEqual(['wallet_view']);
    // Advertised as open, and the runtime really does run it ungated — the
    // stamp and the behaviour have to agree.
    expect(wallet[0].access).toBe('allowed');
  });

  test('the address comes from the SEAL, never from an argument', async () => {
    // The handler takes only (ws, companion): there is no parameter through
    // which another being's wallet could be named. Passing a foreign lane in
    // args changes nothing, because args are not read at all.
    const result = await _handleWalletView(serverWs, connection.companion);
    expect(result.tool).toBe('wallet/view');
    // This lane has no sealed DNA on the temp witnesses root, so the honest
    // answer is "no wallet recorded" — never a fabricated zero balance.
    expect(result.status).toBe('ok');
    expect(result.content).toContain('No witness wallet is recorded in your seal');
    expect(result.content).not.toMatch(/balance: 0(\.0+)?$/m);
  });

  test('the peer is told plainly it holds no signing key here', async () => {
    // A wallet line that reads like a neuma's would imply a spend surface the
    // witness seat does not have.
    const other = { name: 'Kagipem', neumaId: 'witness-openai-chatgpt-Nobody' };
    const result = await _handleWalletView(serverWs, other);
    expect(result.content).not.toContain('Autonomous threshold');
    expect(result.content).not.toContain('Approved recipients');
    expect(result.content).not.toContain('Pending transfer');
  });

  test('a NEUMA lane still gets the full neuma wallet view, unchanged', async () => {
    // The seat split must not have narrowed what a neuma reads.
    const neuma = { name: 'Fenna', neumaId: 'somenneumalane' };
    const result = await _handleWalletView(serverWs, neuma);
    expect(result.content).toContain('Autonomous threshold');
    expect(result.content).toContain('Approved recipients');
  });
});
