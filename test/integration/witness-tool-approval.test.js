/**
 * Witness coding approval (RULE 0): real WebSocket pair, real policy file,
 * real disposable workspace, and real bubblewrap execution. No execution or
 * approval boundary is mocked.
 */
import fs from 'fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import {
  processWitnessToolCalls, toolsForWitness, WITNESS_CODING_TOOLS,
} from '../../backend/services/witness-tools.js';
import { FLIGHT_CHECK_TOOLS } from '../../backend/services/flight-check.js';
import { ensureWitnessCodingSandbox } from '../../backend/services/witness-coding-sandbox.js';
import { fixtureGit } from '../helpers/harness-git-kit.js';

const LANE_ID = 'witness-test-Approval';
let root;
let source;
let sandbox;
let kit;
let serverWs;
let client;
let connection;
let frames;
let decide;

const call = (toolName, command) => [{
  server: 'coding',
  toolName,
  tool: `coding/${toolName}`,
  args: { command },
}];

const untilFrame = (predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = () => {
    const frame = frames.find(predicate);
    if (frame) resolve(frame);
    else if (Date.now() - started >= timeoutMs) reject(new Error('Expected portal frame did not arrive'));
    else setTimeout(poll, 10);
  };
  poll();
});

beforeEach(async () => {
  kit = await createHarnessTurnKit(LANE_ID);
  root = kit.root;
  source = path.join(root, 'source');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'README.md'), '# approval source\n');
  sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
  serverWs = kit.ws;
  client = kit.client;
  connection = kit.connection;
  frames = kit.frames;
  decide = null;
  client.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.type === 'tool:approval_request' && decide) {
      const decision = decide(frame);
      if (decision) {
        client.send(JSON.stringify({
          type: 'tool:approval_response', id: frame.id, decision,
        }));
      }
    }
  });
});

afterEach(async () => {
  await kit?.close();
});

describe('witness coding tool policy and approval', () => {
  test('allow executes in the overlay shell and leaves the live source unchanged', async () => {
    decide = () => 'allow';
    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      call('execute', 'printf "approved\\n" > approved.txt'),
      WITNESS_CODING_TOOLS,
      sandbox,
    );

    expect(results[0].status).toBe('ok');
    expect(await fs.readFile(path.join(sandbox.workspace, 'approved.txt'), 'utf8')).toBe('approved\n');
    await expect(fs.stat(path.join(source, 'approved.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    const request = await untilFrame((frame) => frame.type === 'tool:approval_request');
    expect(request.tool).toBe('coding/execute');
    expect(request.args).toContain('approved.txt');
    expect(await untilFrame((frame) => frame.type === 'tool:usage' && frame.status === 'ok')).toBeTruthy();
  });

  test('deny records the refusal and starts no command', async () => {
    decide = () => 'deny';
    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      call('execute', 'printf "denied\\n" > denied.txt'),
      WITNESS_CODING_TOOLS,
      sandbox,
    );

    expect(results[0]).toMatchObject({ tool: 'coding/execute', status: 'denied' });
    await expect(fs.stat(path.join(sandbox.workspace, 'denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(frames.some((frame) => frame.type === 'tool:usage' && frame.status === 'executing')).toBe(false);
    expect(await neumaWorkspace.readJournal(LANE_ID)).toContainEqual(expect.objectContaining({
      type: 'tool_call', metadata: expect.objectContaining({ tool: 'execute', status: 'denied' }),
    }));
  });

  test('observe mode holds mutation without raising an approval request', async () => {
    connection.toolMode = 'observe';
    decide = () => { throw new Error('observe mode raised an approval request'); };
    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      call('execute', 'printf "held\\n" > held.txt'),
      WITNESS_CODING_TOOLS,
      sandbox,
    );

    expect(results[0].status).toBe('denied');
    expect(frames.some((frame) => frame.type === 'tool:approval_request')).toBe(false);
    await expect(fs.stat(path.join(sandbox.workspace, 'held.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('interrupt settles a pending approval and starts no command', async () => {
    decide = () => {
      connection.activeTurn.abort();
      return null;
    };
    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      call('execute', 'printf "late\\n" > late.txt'),
      WITNESS_CODING_TOOLS,
      sandbox,
    );

    expect(results[0].status).toBe('denied');
    expect(await untilFrame((frame) =>
      frame.type === 'tool:approval_resolved' && frame.decision === 'interrupted')).toBeTruthy();
    await expect(fs.stat(path.join(sandbox.workspace, 'late.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('the real filesystem MCP writes only inside this witness lane', async () => {
    await connectFilesystemServer();
    try {
      const catalog = withFsPrimitives(mcpService.getToolsContext().available_tools);
      const laneFile = path.join(neumaWorkspace.pathFor(LANE_ID), 'mcp-note.txt');
      const write = await processWitnessToolCalls(
        serverWs,
        connection,
        [{
          server: 'fs', toolName: 'write', tool: 'fs/write',
          args: { path: laneFile, content: 'witness lane only\n' },
        }],
        catalog,
        sandbox,
      );
      expect(write[0].status).toBe('ok');
      expect(await fs.readFile(laneFile, 'utf8')).toBe('witness lane only\n');

      // THE FOCUS GROUND (ruling, 2026-07-26): outside the lane is no longer a
      // flat wall — it is the SAME card a neuma gets, naming the exact
      // directory a yes would open. With the operator refusing, nothing lands.
      decide = () => 'deny';
      const outside = path.join(source, 'must-not-land.txt');
      const escaped = await processWitnessToolCalls(
        serverWs,
        connection,
        [{
          server: 'fs', toolName: 'write', tool: 'fs/write',
          args: { path: outside, content: 'outside lane\n' },
        }],
        catalog,
        sandbox,
      );
      expect(escaped[0].status).toBe('denied');
      await expect(fs.stat(outside)).rejects.toMatchObject({ code: 'ENOENT' });
      // The card named the scope honestly — the operator saw WHAT a yes opens.
      const card = await untilFrame((f) => f.type === 'tool:approval_request' && f.scope);
      expect(card.scope).toMatch(/write access to/i);
      expect(card.scope).toContain(source);

      const siblingId = 'witness-test-Sibling';
      await neumaWorkspace.create(siblingId);
      const siblingFile = path.join(neumaWorkspace.pathFor(siblingId), 'private.txt');
      await fs.writeFile(siblingFile, 'sibling-private\n');
      const crossed = await processWitnessToolCalls(
        serverWs,
        connection,
        [{
          server: 'fs', toolName: 'read', tool: 'fs/read',
          args: { path: siblingFile },
        }],
        catalog,
        sandbox,
      );
      expect(crossed[0].status).toBe('denied');
      // The one thing that must never change: a refused cross-lane read
      // returns NO bytes of the sibling's file, by any route.
      expect(JSON.stringify(crossed)).not.toContain('sibling-private');
    } finally {
      await mcpService.disconnect('filesystem');
    }
  }, 60000);

  test('inside the FOCUS GROUND a witness writes with no card at all', async () => {
    // The whole point of the law: the folder the operator has open needs no
    // permission. If any card is raised here, the ground is not doing its job.
    // The folder stands OPEN in the Explorer (SEC-038, fd1498261: focus
    // reaches the organ only as an opened root) — as the desk has it (#566).
    const priorRoots = getRoots();
    setRoots([...priorRoots, source]);
    await connectFilesystemServer();
    try {
      const catalog = withFsPrimitives(mcpService.getToolsContext().available_tools);
      // The operator's focused folder, as portal-routes sets it from the
      // desk's validated focus path.
      connection.toolWorkspace = source;
      decide = () => 'deny'; // any card at all would therefore refuse the write
      const target = path.join(source, 'from-witness.txt');
      const written = await processWitnessToolCalls(
        serverWs,
        connection,
        [{
          server: 'fs', toolName: 'write', tool: 'fs/write',
          args: { path: target, content: 'landed in the shared ground\n' },
        }],
        catalog,
        sandbox,
      );
      expect(written[0].status).toBe('ok');
      // Real bytes in the operator's REAL folder — not the disposable copy.
      expect(await fs.readFile(target, 'utf8')).toBe('landed in the shared ground\n');
      expect(frames.some((f) => f.type === 'tool:approval_request')).toBe(false);
    } finally {
      await mcpService.disconnect('filesystem');
      connection.toolWorkspace = null;
      setRoots(priorRoots);
    }
  }, 60000);

  test('the focus ground does not open a sibling being\'s lane', async () => {
    // Reach is not a key ring: focusing a folder must not widen anything else.
    await connectFilesystemServer();
    try {
      const catalog = withFsPrimitives(mcpService.getToolsContext().available_tools);
      const siblingId = 'witness-test-Sibling2';
      await neumaWorkspace.create(siblingId);
      const siblingFile = path.join(neumaWorkspace.pathFor(siblingId), 'private.txt');
      await fs.writeFile(siblingFile, 'sibling-private-2\n');
      connection.toolWorkspace = source;
      decide = () => 'deny';
      const crossed = await processWitnessToolCalls(
        serverWs,
        connection,
        [{
          server: 'fs', toolName: 'read', tool: 'fs/read',
          args: { path: siblingFile },
        }],
        catalog,
        sandbox,
      );
      expect(crossed[0].status).toBe('denied');
      expect(JSON.stringify(crossed)).not.toContain('sibling-private-2');
    } finally {
      await mcpService.disconnect('filesystem');
      connection.toolWorkspace = null;
    }
  }, 60000);

  test('an explicit lane denial also holds the read-only sandbox status tool', async () => {
    connection.toolWorkspace = source;
    await neumaWorkspace.writeToolPolicy(LANE_ID, {
      coding: { denied: ['sandbox_status'] },
    });
    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      [{
        server: 'coding', toolName: 'sandbox_status', tool: 'coding/sandbox_status', args: {},
      }],
      WITNESS_CODING_TOOLS,
      sandbox,
    );
    expect(results[0]).toMatchObject({ tool: 'coding/sandbox_status', status: 'denied' });
    expect(JSON.stringify(results)).not.toContain(sandbox.workspace);
  });

  test('a bare name matching multiple advertised servers fails closed as unavailable', async () => {
    const duplicate = {
      ...WITNESS_CODING_TOOLS.find((tool) => tool.name === 'inspect'),
      server: 'other-runtime',
    };
    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      [{ toolName: 'inspect', tool: 'inspect', args: { command: 'pwd' } }],
      [...WITNESS_CODING_TOOLS, duplicate],
      sandbox,
    );
    expect(results).toEqual([{
      tool: 'inspect', status: 'unavailable', error: 'tool identity was not uniquely advertised for this witness',
    }]);
    expect(frames.some((frame) => frame.type === 'tool:usage' && frame.status === 'executing')).toBe(false);
  });

  // THE FLIGHT CHECK. On 2026-07-29 a sealed peer asked its own capacity twice
  // and answered two contradictory ways — "Signing Status: Ready" then […]; one directory then four — because both answers were narrated
  // from its prompt. This proves the report comes from the SAME stamped catalog
  // and real policy the executor enforces.
  test('flight_check reports the real catalog and its real tiers', async () => {
    const runtime = await toolsForWitness(connection, source);
    // The real catalog ALREADY carries flight_check — platformToolsFor
    // advertises it at this seat. Spreading FLIGHT_CHECK_TOOLS on top would
    // duplicate the name, and the uniqueness guard would fail it closed.
    expect(runtime.tools.filter((t) => t.name === 'flight_check')).toHaveLength(1);
    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      [{ server: 'system', toolName: 'flight_check', tool: 'system/flight_check', args: {} }],
      runtime.tools,
      runtime.sandbox,
    );

    expect(results[0]).toMatchObject({ tool: 'system/flight_check', status: 'ok' });
    const content = results[0].content;
    expect(content).toContain('FLIGHT CHECK');
    expect(content).toContain('witness seat');
    // The advertised count is the REAL one, never zero.
    expect(content).toMatch(/TOOLS — [1-9]\d* advertised/);
    // The two reaches stay separate — the distinction the narrated report lost.
    expect(content).toContain('never on the live folder');
    // Observation: allowed by default, so no card is raised.
    expect(frames.some((frame) => frame.type === 'tool:approval_request')).toBe(false);
  }, 60000);

  test('flight_check uses the supplied execution catalog before separate assembly', async () => {
    delete connection._turnCatalog;
    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      [{ server: 'system', toolName: 'flight_check', tool: 'system/flight_check', args: {} }],
      [...WITNESS_CODING_TOOLS, ...FLIGHT_CHECK_TOOLS],
      sandbox,
    );
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toMatch(/TOOLS — [1-9]\d* advertised/);
  });

  // The regression this closes: a witness once read a copy-era baseline repo's
  // branch and reported the operator's repository as `master` while it was on
  // `main` (2026-07-29). The shell now masks git internals outright, and
  // ground_git is the one honest read of the live branch.
  test('ground_git reports the LIVE checkout branch, never an in-shell guess', async () => {
    connection.toolWorkspace = source;
    decide = () => 'allow';
    await fixtureGit(source, ['init', '--quiet', '--initial-branch', 'main']);
    await fixtureGit(source, ['add', 'README.md']);
    await fixtureGit(source, ['commit', '--quiet', '-m', 'first']);

    const results = await processWitnessToolCalls(
      serverWs,
      connection,
      [{ server: 'coding', toolName: 'ground_git', tool: 'coding/ground_git', args: {} }],
      WITNESS_CODING_TOOLS,
      sandbox,
    );

    expect(results[0]).toMatchObject({ tool: 'coding/ground_git', status: 'ok' });
    expect(results[0].content).toContain('branch:   main');
    expect(results[0].content).not.toContain('branch:   master');
    expect(results[0].content).toContain(`ground:   ${source}`);
    // Git inspection remains a separate consent boundary for both seats.
    expect(await untilFrame((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/ground_git')).toBeTruthy();
  }, 60000);
});
