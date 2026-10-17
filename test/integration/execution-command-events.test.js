import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { ensureWitnessCodingSandbox } from '../../backend/services/witness-coding-sandbox.js';
import { processWitnessToolCalls, WITNESS_CODING_TOOLS } from '../../backend/services/witness-tools.js';
import { handleBeingCodingTool } from '../../backend/services/being-tool-surface.js';
import { sendToolEvent } from '../../backend/services/witness-tool-events.js';
import { openTurnRecord, turnRecordFor, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import { cueForAct } from '../../frontend/services/act-sound-map.js';

test.each(['witness', 'neuma'])('%s execution events keep the command through output, completion and history', async (seat) => {
  const kit = await createHarnessTurnKit(seat === 'witness' ? 'witness-openai-execution-proof' : 'execution-proof');
  try {
    const { connection, ws, ground } = kit;
    await fs.writeFile(path.join(ground, 'package.json'), JSON.stringify({ scripts: {
      build: 'node build.cjs', test: 'node --test test.cjs',
    } }));
    await fs.writeFile(path.join(ground, 'build.cjs'), 'require("fs").writeFileSync("built.txt", "built"); console.log("build complete");');
    await fs.writeFile(path.join(ground, 'test.cjs'), 'require("node:test")("arithmetic", () => require("node:assert/strict").equal(2 + 2, 4));');
    connection.toolWorkspace = ground;
    connection._turnSandbox = await ensureWitnessCodingSandbox(kit.laneId, ground);
    connection._turnCatalog = WITNESS_CODING_TOOLS;
    kit.client.on('message', (bytes) => {
      const frame = JSON.parse(bytes.toString());
      if (frame.type === 'tool:approval_request') kit.decide(frame,
        frame.tool === 'coding/shell_network' ? 'deny' : 'allow');
    });
    openTurnRecord(ws);
    for (const command of ['npm run build', 'npm test', 'node --check missing.cjs']) {
      const call = { server: 'coding', toolName: 'execute', tool: 'coding/execute', args: { command } };
      const result = seat === 'witness'
        ? (await processWitnessToolCalls(ws, connection, [call], WITNESS_CODING_TOOLS, connection._turnSandbox))[0]
        : await handleBeingCodingTool(ws, connection, null, 'ask', call, call.args, { sendToolEvent });
      expect(result.status).toBe(command.includes('missing') ? 'error' : 'ok');
      await untilHarness(() => kit.frames.find((frame) => frame.type === 'tool:usage'
        && frame.status === result.status && frame.summary?.includes(command)));
    }
    expect(await fs.readFile(path.join(connection._turnSandbox.workspace, 'built.txt'), 'utf8')).toBe('built');
    const events = kit.frames.filter((frame) => frame.type === 'tool:usage' && frame.activity);
    const starts = events.filter((frame) => frame.status === 'executing' && !frame.progress);
    expect(starts.map(cueForAct)).toEqual(['actBuild', 'actTest', 'actCheck']);
    const progress = events.filter((frame) => frame.progress);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((frame) => cueForAct(frame) === null)).toBe(true);
    const recordPath = path.join(kit.root, 'actions.json');
    await fs.writeFile(recordPath, JSON.stringify(turnRecordFor(ws)));
    const stored = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    expect(stored.map(({ summary }) => summary).filter((summary) => /^(BUILD|TEST|CHECK) · /.test(summary))).toEqual([
      'BUILD · npm run build — exit 0', 'TEST · npm test — exit 0', 'CHECK · node --check missing.cjs — exit 1',
    ]);
  } finally {
    closeTurnRecord(kit.ws);
    await kit.close();
  }
}, 60000);
