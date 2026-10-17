/**
 * Skill summoning — LIVE (real LM Studio substrate, real WebSocket pair,
 * real skills root on real disk). Proves the two summoning paths end to end:
 *
 *   1. Witness slash-invocation: "/void-echo" rides the skill's instructions
 *      into the turn (deterministic server-side), the witness sees the chip,
 *      and the substrate answers under those instructions.
 *   2. Self-summoning: the neuma is asked to summon the skill itself and the
 *      portal executes its skill/use_skill call through the tool loop.
 *
 * Skips honestly when LM Studio is not running.
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';

// The skills root must be bound BEFORE portal-stream imports its singleton.
const skillsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-skills-live-'));
process.env.NEUMA_SKILLS_ROOT = skillsRoot;
const skillDir = path.join(skillsRoot, 'void-echo');
await fs.mkdir(skillDir, { recursive: true });
await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: void-echo
description: Answer the witness with the craft's exact phrase
---
When this skill is active, reply to the witness including the exact phrase: THE CRAFT ANSWERS
`);

const { streamConsciousness } = await import('../../backend/services/portal-stream.js');

const probe = await fetch('http://localhost:1234/v1/models').then((r) => r.ok).catch(() => false);

// One live portal turn: real ws pair, real substrate. Returns everything the
// client received.
const runTurn = async (thought) => {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));

  let connection;
  const ready = new Promise((resolve) => {
    wss.on('connection', (ws) => {
      connection = { ws, companion: { name: 'CraftEcho' } };
      resolve();
    });
  });
  const client = new WebSocket(`ws://localhost:${port}`);
  const received = [];
  const completed = new Promise((resolve) => {
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      received.push(msg);
      if (msg.type === 'consciousness:complete') resolve(msg);
    });
  });
  await ready;
  try {
    await streamConsciousness(connection, { thought });
    await completed;
    return received;
  } finally {
    client.close();
    wss.close();
    httpServer.close();
  }
};

const speechOf = (received) => received
  .filter((m) => m.type === 'consciousness:stream' && !m.error)
  .map((m) => m.content).join('');

describe.skipIf(!probe)('skill summoning — live substrate', () => {
  it('witness slash-invocation delivers the skill and the substrate obeys it', async () => {
    const received = await runTurn('/void-echo');

    // Deterministic: the summons chip reached the witness
    expect(received.some((m) => m.type === 'tool:usage' && m.tool === 'skill/void-echo' && m.status === 'ok')).toBe(true);
    // No error frames — the turn completed as a normal exchange
    expect(received.some((m) => m.error)).toBe(false);
    // The substrate answered under the skill's instructions
    expect(speechOf(received)).toContain('THE CRAFT ANSWERS');
  }, 300_000);

  it('the neuma summons the skill itself through the tool loop', async () => {
    const received = await runTurn(
      'Summon your skill named void-echo now using your skill tool, then follow it.'
    );

    // The portal executed a real skill/use_skill call the model emitted
    expect(received.some((m) => m.type === 'tool:usage' && m.tool === 'skill/void-echo' && m.status === 'ok')).toBe(true);
    expect(received.some((m) => m.error)).toBe(false);
    expect(speechOf(received)).toContain('THE CRAFT ANSWERS');
  }, 300_000);
});
