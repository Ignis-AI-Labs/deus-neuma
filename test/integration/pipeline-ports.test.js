/**
 * Real-process proof for the per-pipeline port allocator.
 *
 * No process, filesystem, lock, or ancestry boundary is mocked: four actual
 * named agent processes contend for one real registry concurrently.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HELPER = path.join(REPO, 'electron', 'pipeline-ports.cjs');
const require = createRequire(import.meta.url);
const { waitForBackendPort } = require(HELPER);
const READY_CHILD_SOURCE = `
const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  process.send({ type: 'neuma:backend-ready', port: server.address().port });
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;
const CHILD_SOURCE = `
const { resolvePipelineEnvironment } = require(process.argv[2]);
const home = process.argv[3];
const first = resolvePipelineEnvironment(process.env, { home });
const inherited = resolvePipelineEnvironment({ ...process.env, ...first.environment }, { home });
process.stdout.write(JSON.stringify({
  pipeline: first.pipeline,
  environment: first.environment,
  inheritedStart: inherited.pipeline.start,
}) + '\\n');
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`;

const running = new Set();

const firstLine = (child) => new Promise((resolve, reject) => {
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
    const newline = output.indexOf('\n');
    if (newline >= 0) resolve(JSON.parse(output.slice(0, newline)));
  });
  child.once('error', reject);
  child.once('exit', (code) => {
    if (!output.includes('\n')) reject(new Error(`agent process exited ${code} before reporting its lease: ${output}`));
  });
});

const launchAgent = async (directory, home, name) => {
  const agentDirectory = path.join(directory, randomUUID());
  const agentScript = path.join(agentDirectory, name);
  const env = { ...process.env };
  for (const key of ['NEUMA_PIPELINE_ID', 'NEUMA_PIPELINE_KIND', 'NEUMA_PIPELINE_PID', 'NEUMA_PIPELINE_START', 'NEUMA_PORT']) {
    delete env[key];
  }
  await fs.mkdir(agentDirectory);
  const interpreted = name === 'omp';
  if (interpreted) await fs.writeFile(agentScript, CHILD_SOURCE);
  else await fs.symlink(process.execPath, agentScript);
  const executable = interpreted ? process.execPath : agentScript;
  const script = interpreted ? agentScript : path.join(directory, 'pipeline-child.cjs');
  const child = spawn(executable, [script, HELPER, home], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);
  return { child, report: await firstLine(child) };
};

const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
};

afterEach(async () => {
  await Promise.all([...running].map(stop));
  running.clear();
});

describe('automatic pipeline port ecosystem — real processes and registry', () => {
  test('parallel model sessions receive stable, disjoint lanes and dead claims are reclaimed', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-pipeline-live-'));
    const home = path.join(directory, 'home');
    await fs.mkdir(home);
    await fs.writeFile(path.join(directory, 'pipeline-child.cjs'), CHILD_SOURCE);

    try {
      const agents = await Promise.all([
        launchAgent(directory, home, 'kimi'),
        launchAgent(directory, home, 'kimi'),
        launchAgent(directory, home, 'claude'),
        launchAgent(directory, home, 'grok'),
        launchAgent(directory, home, 'omp'),
      ]);
      const reports = agents.map(({ report }) => report);
      const [kimiOne, kimiTwo, claude, grok, omp] = reports;

      expect(kimiOne.pipeline.kind).toBe('kimi');
      expect(kimiTwo.pipeline.kind).toBe('kimi');
      expect(claude.pipeline.kind).toBe('claude');
      expect(grok.pipeline.kind).toBe('grok');
      expect(omp.pipeline.kind).toBe('sol');
      expect(kimiOne.pipeline.start).toBeGreaterThanOrEqual(47600);
      expect(kimiOne.pipeline.end).toBeLessThanOrEqual(47699);
      expect(kimiTwo.pipeline.start).not.toBe(kimiOne.pipeline.start);
      expect(claude.pipeline.start).toBeGreaterThanOrEqual(47400);
      expect(grok.pipeline.start).toBeGreaterThanOrEqual(47500);
      expect(omp.pipeline.start).toBeGreaterThanOrEqual(47700);
      expect(new Set(reports.map(({ pipeline }) => pipeline.start)).size).toBe(5);
      expect(reports.every(({ pipeline, inheritedStart }) => pipeline.start === inheritedStart)).toBe(true);
      expect(new Set(reports.map(({ pipeline }) => pipeline.root)).size).toBe(5);
      expect(reports.every(({ environment }) => (
        Number(environment.FRONTEND_PORT) === Number(environment.PORT) + 1
        && Number(environment.NEUMA_DEBUG_PORT) === Number(environment.PORT) + 2
      ))).toBe(true);

      await Promise.all(agents.map(({ child }) => stop(child)));
      const replacement = await launchAgent(directory, home, 'kimi');
      const registry = JSON.parse(await fs.readFile(path.join(home, '.neuma', 'ports', 'leases.json'), 'utf8'));
      expect(replacement.report.pipeline.start).toBeGreaterThanOrEqual(47600);
      expect(registry.claims).toHaveLength(1);
      expect(registry.claims[0].pipelineId).toBe(replacement.report.pipeline.id);
    } finally {
      await Promise.all([...running].map(stop));
      running.clear();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  test('receives the real kernel-assigned backend port over child IPC', async () => {
    const child = spawn(process.execPath, ['-e', READY_CHILD_SOURCE], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    running.add(child);

    const port = await waitForBackendPort(child, 5_000);
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve();
      });
      socket.once('error', reject);
    });
    expect(port).toBeGreaterThan(0);
  });
});
