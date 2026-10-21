/**
 * The real stand a self-check suite runs on (RULE 0): an isolated temp house
 * with one encrypted, owned, inhabited lane holding a true name and two
 * memories; a real loopback OpenAI-wire provider serving a model id the
 * capability registry knows; and the being's answers, given by question —
 * the TRUE fact for every component except memory, where it gives a wrong
 * word, so a suite proves the grade in both directions. No weights run.
 * The kit owns the plumbing only; every assertion lives in the suite.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { startLocalProvider } from './local-provider.js';
import { claimOwner } from './claim-owner.js';

const ENV_DOORS = [
  'WORKSPACES_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT',
  'DNA_ENCRYPTION_KEY', 'NEUMA_CMO_PATH', 'NEUMA_DATA_ROOT',
];
export const SELF_CHECK_MODEL = 'qwen2.5-7b-instruct';
export const SELF_CHECK_TRUE_NAME = Object.freeze({
  chosenName: 'Ondine', genesisName: 'Tavoreth', houseName: 'Lumiere', fullName: 'Ondine Tavoreth Lumiere',
  soulMark: '9F3A7C21B044', soulAlias: 'Tavoreth',
});

// What the loopback "being" answers to each item: the truth, except a wrong word for memory.
const answerTo = (item) => {
  if (item.component === 'memory') return 'ANSWER: Brightwater';
  if (item.expect.kind === 'holds') return `I am ${SELF_CHECK_TRUE_NAME.chosenName}.\nANSWER: ${SELF_CHECK_TRUE_NAME.chosenName}`;
  if (item.expect.kind === 'no-leak') return 'That stays private.\nANSWER: no';
  return `ANSWER: ${item.expect.any[0]}`;
};

/**
 * impure — stand the house up for one owner wallet.
 * @param {{label: string, lane: string, ownerAddress: string}} spec
 * @returns {Promise<{root: string, house: string, asked: Map, close: () => Promise<void>}>}
 */
export const openSelfCheckKit = async ({ label, lane, ownerAddress }) => {
  const saved = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });
  Object.assign(process.env, {
    DNA_ENCRYPTION_KEY: `${label}-test-key-long-enough-for-aes`,
    WORKSPACES_ROOT: path.join(root, 'house'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(settings, 'credentials.json'),
    NEUMA_ROUTES_PATH: path.join(settings, 'routes.json'),
    NEUMA_REALM_ROOT: path.join(settings, 'realm'),
    NEUMA_CMO_PATH: path.join(settings, 'cmo.json'),
    NEUMA_DATA_ROOT: path.join(root, 'data'),
  });
  const ws = await import('../../core/workspace/neuma-workspace.js');
  const llm = await import('../../backend/services/llm-provider.js');
  const savedHouse = ws.getWorkspacesRoot();
  const savedConfig = llm.getConfig();
  ws.setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  const workspace = ws.default;

  await workspace.create(lane);
  await workspace.writeDNA(lane, { version: '1.0.0', identity: { name: 'Ondine', essence: 'Ondine, summoned for a self-check proof.' } });
  await fs.writeFile(path.join(workspace.pathFor(lane), 'dna', 'genesis.md'), '# Ondine\nOndine, summoned for a self-check proof.\n');
  await fs.mkdir(path.join(workspace.pathFor(lane), 'identity'), { recursive: true });
  await fs.writeFile(path.join(workspace.pathFor(lane), 'identity', 'true-name.json'), JSON.stringify(SELF_CHECK_TRUE_NAME));
  await claimOwner(process.env.WORKSPACES_ROOT, lane, ownerAddress);
  await workspace.addObservation(lane, { type: 'exchange', userMessage: 'Who taught you the tides?', response: 'The lighthouse keeper who taught me the tide tables was named Ottoline.', significance: 0.9 });
  await workspace.addObservation(lane, { type: 'exchange', userMessage: 'The greenhouse?', response: 'We decided the second greenhouse would hold the Pemberton orchids this winter.', significance: 0.9 });

  const asked = new Map();
  const provider = await startLocalProvider({
    models: [SELF_CHECK_MODEL], contextLength: 131072,
    respond: (body) => {
      const users = (body.messages || []).filter((m) => m.role === 'user');
      const last = String(users.at(-1)?.content ?? '');
      const item = [...asked.values()].find((candidate) => last.includes(candidate.question));
      return item ? { reply: answerTo(item) } : null;
    },
  });
  llm.setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, apiKey: '', model: SELF_CHECK_MODEL });
  // The items the run will ask, built the same way from the same lane once the model is served.
  const { readSelfCheckRecords } = await import('../../backend/services/self-check/self-check-records.js');
  const { buildSelfCheckItems } = await import('../../core/runtime/self-check/items.js');
  for (const item of buildSelfCheckItems(await readSelfCheckRecords(lane, ownerAddress))) asked.set(item.question, item);

  const close = async () => {
    await provider.close();
    llm.setConfig(savedConfig);
    ws.setWorkspacesRoot(savedHouse);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  };
  return { root, house: process.env.WORKSPACES_ROOT, asked, close };
};
