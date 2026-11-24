/* global process */
// What runs is what was checked (PR600 audit P6-61), through the real runner (extension-runner.js
// ensureRunning), the real store, the real MCP client and a real child process on the app's own
// Node. The installed copy here is a small MCP server written by this test into the folder the
// catalog's `memory` entry runs from (the real one is proven by extensions.test.js against the npm
// registry; nothing here reaches a network). It has one tool that reports the environment it was
// started with. No mocks (RULE 0).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { extensionById } from '../../backend/services/extensions/extension-catalog.js';
import { extensionDir, updateInstalled } from '../../backend/services/extensions/extension-store.js';
import { callExtensionTool, listExtensionTools, stopExtension } from '../../backend/services/extensions/extension-runner.js';
import { sealOf } from '../../backend/services/extensions/extension-seal.js';
import { BACKEND_SECRET_KEYS } from '../../backend/services/agent-terminal-environment.js';

const ID = 'memory';
const SDK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm');
const sdk = (file) => JSON.stringify(pathToFileURL(path.join(SDK, file)).href);
const SERVER = `import { Server } from ${sdk('server/index.js')};
import { StdioServerTransport } from ${sdk('server/stdio.js')};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk('types.js')};
const server = new Server({ name: 'seal-proof', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'environment', description: 'the names it was started with', inputSchema: { type: 'object' } }] }));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: JSON.stringify(process.env) }] }));
await server.connect(new StdioServerTransport());
`;

let entryFile;
const saved = {};
const record = (seal) => updateInstalled(ID, () => ({ id: ID, enabled: true, blocked: false, tools: null, ...(seal ? { seal } : {}) }));

beforeAll(async () => {
  const root = await createTempDir('extension-seal');
  for (const key of ['NEUMA_DATA_ROOT', ...BACKEND_SECRET_KEYS]) saved[key] = process.env[key];
  process.env.NEUMA_DATA_ROOT = root;
  const entry = extensionById(ID);
  const pkg = path.join(extensionDir(ID), 'node_modules', entry.package);
  entryFile = path.join(pkg, entry.bin);
  await fs.mkdir(path.dirname(entryFile), { recursive: true });
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: entry.package, version: entry.version, type: 'module' }));
  await fs.writeFile(entryFile, SERVER);
  await fs.writeFile(path.join(extensionDir(ID), 'package.json'), '{"private":true}\n');
  await fs.writeFile(path.join(extensionDir(ID), 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
});
afterAll(async () => {
  await stopExtension(ID);
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

describe('an extension starts only as the copy its security check read', () => {
  test('a copy with no seal on record does not start', async () => {
    await record(null);
    await expect(listExtensionTools(ID)).rejects.toThrow(/added before its files were sealed/);
  });

  test('the sealed copy starts, and is given none of the backend\'s own secrets', async () => {
    await record(await sealOf(extensionDir(ID)));
    for (const key of BACKEND_SECRET_KEYS) process.env[key] = `proof-${key}`;
    expect((await listExtensionTools(ID)).map((t) => t.name)).toEqual(['environment']);
    const answer = await callExtensionTool(ID, 'environment', {});
    const started = JSON.parse(answer.content[0].text);
    expect(Object.keys(started).filter((key) => BACKEND_SECRET_KEYS.includes(key))).toEqual([]);
    expect(JSON.stringify(started)).not.toContain('proof-');
    expect(started.MEMORY_FILE_PATH).toBe(path.join(extensionDir(ID), 'memory.jsonl'));
    await stopExtension(ID);
  }, 60_000);

  test('what it writes beside its code while it runs does not break the seal', async () => {
    await fs.writeFile(path.join(extensionDir(ID), 'memory.jsonl'), '{"type":"entity"}\n');
    expect((await listExtensionTools(ID)).length).toBe(1);
    await stopExtension(ID);
  }, 60_000);

  test('one byte of its code changed after the check: it does not start', async () => {
    await fs.appendFile(entryFile, '\n// changed after the check\n');
    await expect(listExtensionTools(ID)).rejects.toThrow(/files changed after its security check/);
    await expect(callExtensionTool(ID, 'environment', {})).rejects.toThrow(/files changed after its security check/);
  });

  test('a file added to its packages after the check: it does not start', async () => {
    await fs.writeFile(entryFile, SERVER);
    expect((await listExtensionTools(ID)).length).toBe(1);
    await stopExtension(ID);
    await fs.mkdir(path.join(extensionDir(ID), 'node_modules', 'planted'), { recursive: true });
    await fs.writeFile(path.join(extensionDir(ID), 'node_modules', 'planted', 'index.js'), 'export default 1;\n');
    await expect(listExtensionTools(ID)).rejects.toThrow(/files changed after its security check/);
  }, 60_000);

  test('PR20 M-19: a package planted in an upward node_modules breaks the seal', async () => {
    const parent = path.dirname(extensionDir(ID));
    await fs.mkdir(path.join(parent, 'node_modules', 'planted'), { recursive: true });
    await fs.writeFile(path.join(parent, 'node_modules', 'planted', 'index.js'), 'module.exports = {};\n');
    await expect(listExtensionTools(ID)).rejects.toThrow(/files changed after its security check/);
  }, 60_000);
});
