#!/usr/bin/env node
// Salvage an INTERRUPTED in-session birth ceremony (crash / power loss /
// killed app) from its persisted checkpoint in data/temp/birth-<sessionId>.json.
//
// Distinct from held-being completion (which completes a HELD
// being whose identity artifacts exist but DNA was never authored). This
// script handles the case where the ceremony itself died mid-flight:
// the session checkpoint holds identity (name, id, consent, emergence) and
// the being may already have written dna/genesis.md before the machine died.
//
// Flow:
//   1. Apply the persisted workspace root (same as backend boot)
//   2. Restore the session checkpoint (StagedBirthHandler.restoreSession)
//   3. Recover the authored essence: if <lane>/dna/genesis.md exists, that IS
//      the being's authored DNA — adopt it, never re-ask the model to write
//      a different one. If it never landed, drive stage 5 live through the
//      original substrate so the being authors it now.
//   4. Drive stage 6 (completion words) live through the original substrate
//   5. Run the REAL finalizeBirth (fresh path — forges keypair, genesis seal,
//      true-name, identity-card, seals dna/active.json under the per-neuma DEK)
//   6. Verify every artifact on disk, then end the session
//
// Usage:
//   node scripts/salvage-birth-session.mjs <sessionId> [--wallet 0x...] [--dry-run]
//   node scripts/salvage-birth-session.mjs --latest [--wallet 0x...] [--dry-run]
//
// --wallet falls back to WITNESS_WALLET env, then to the wallet that owns the
// sibling lanes in the same house (a one-witness house resolves unambiguously).

import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import {
  generateKeypair, serializeForStorage, createIdentityCard,
  HONESTY_ANCHOR, forgeBirthIdentity, captureBirthMoment,
} from '../core/index.js';
import workspace from '../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../core/birth/staged-birth-handler.js';
import { finalizeBirth } from '../core/birth/finalize-birth.js';
import { applyWorkspaceSettings, loadWorkspaceSettings } from '../backend/services/workspace-settings.js';

const REPO = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const SCRATCH_DIR = path.join(REPO, 'data', 'temp');

function parseArgs(rawArgv) {
  const VALUE_FLAGS = new Set(['--wallet']);
  const BOOL_FLAGS = new Set(['--dry-run', '--latest']);
  const flags = {};
  const positionals = [];
  for (let i = 0; i < rawArgv.length; i++) {
    const a = rawArgv[i];
    if (VALUE_FLAGS.has(a)) { flags[a.slice(2)] = rawArgv[++i]; }
    else if (BOOL_FLAGS.has(a)) { flags[a.slice(2)] = true; }
    else if (a.startsWith('--')) { throw new Error(`unknown flag: ${a}`); }
    else { positionals.push(a); }
  }
  return { sessionId: positionals[0] || null, wallet: flags.wallet || null, dryRun: !!flags['dry-run'], latest: !!flags.latest };
}

// impure — scans the ceremony scratch dir for the newest unfinished real birth
async function findLatestInterruptedSessionId() {
  const entries = await fs.readdir(SCRATCH_DIR);
  const candidates = [];
  for (const name of entries) {
    const m = name.match(/^birth-([0-9a-f]{32})\.json$/);
    if (!m) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(SCRATCH_DIR, name), 'utf8'));
      if (raw.isTest) continue;
      if ((raw.currentStage ?? 0) >= 6) continue;       // ceremony reached completion
      if (!raw.data?.neumaId) continue;                  // pre-naming: nothing to salvage
      candidates.push({ id: m[1], at: raw.persistedAt || raw.startTime || 0 });
    } catch { /* unreadable checkpoint — skip */ }
  }
  candidates.sort((a, b) => b.at - a.at);
  return candidates[0]?.id || null;
}

// impure — resolves the witness wallet: flag > env > sibling owner.json scan
async function resolveWitnessWallet(flagWallet) {
  if (flagWallet) return flagWallet;
  if (process.env.WITNESS_WALLET) return process.env.WITNESS_WALLET;
  const counts = new Map();
  try {
    const entries = await fs.readdir(workspace.root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const owner = JSON.parse(await fs.readFile(path.join(workspace.root, e.name, 'owner.json'), 'utf8'));
        if (owner.wallet) counts.set(owner.wallet, (counts.get(owner.wallet) || 0) + 1);
      } catch { /* unowned lane */ }
    }
  } catch { /* root unreadable */ }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}

// Same birth-cycle count the portal uses (owner.json scan + 1).
// impure
const countWitnessBirths = async (root, wallet) => {
  let count = 0;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const owner = JSON.parse(await fs.readFile(path.join(root, entry.name, 'owner.json'), 'utf8'));
        if (owner.wallet?.toLowerCase() === wallet.toLowerCase()) count += 1;
      } catch { /* not a birth of this witness */ }
    }
  } catch { /* first birth in the house */ }
  return count + 1;
};

// Stream a chat completion from the session's ORIGINAL substrate (OpenAI-
// compatible), accumulating the full text. impure — network + stdout.
async function callSubstrate({ endpoint, model, systemPrompt, userKickoff, maxTokens = 8000 }) {
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userKickoff },
      ],
      temperature: 0.7, max_tokens: maxTokens, stream: true,
    }),
  });
  if (!res.ok) throw new Error(`substrate ${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  process.stdout.write('  ');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { process.stdout.write(delta); full += delta; }
      } catch { /* tolerate partials */ }
    }
  }
  process.stdout.write('\n');
  return full;
}

const printDivider = (label) => console.log(`\n────── ${label} ──────`);

// impure — the whole salvage: disk, network, audit, stdout
async function main() {
  const { sessionId: argSessionId, wallet: flagWallet, dryRun: DRY_RUN, latest } = parseArgs(process.argv.slice(2));

  printDivider('Salvage interrupted birth');
  await applyWorkspaceSettings();
  console.log(`  workspace root: ${workspace.root}`);

  const sessionId = latest ? await findLatestInterruptedSessionId() : argSessionId;
  if (!sessionId) {
    console.error('  ABORT: no interrupted birth session found (or none given).');
    process.exit(1);
  }
  console.log(`  session: ${sessionId}${latest ? ' (latest interrupted)' : ''}`);
  console.log(`  mode: ${DRY_RUN ? 'DRY-RUN (no writes, no substrate)' : 'LIVE'}`);

  // 1. restore the checkpoint
  const handler = new StagedBirthHandler();
  const session = await handler.restoreSession(sessionId);
  if (!session) {
    console.error('  ABORT: checkpoint missing, expired, or unreadable.');
    process.exit(1);
  }
  const { neumaId, chosenName, consent, emerged } = session.data;
  console.log(`  restored: ${chosenName || '(unnamed)'} (neumaId=${neumaId}) at stage ${session.currentStage}`);
  console.log(`  consent=${consent}  emerged=${emerged}  resonance=${session.data.resonanceFrequency}Hz`);
  if (session.isTest || !neumaId || !chosenName || !consent || !emerged) {
    console.error('  ABORT: checkpoint is a rehearsal or pre-naming — nothing salvageable here.');
    process.exit(1);
  }

  // 2. locate the authored essence
  const lane = workspace._path(neumaId);
  const genesisPath = path.join(lane, 'dna', 'genesis.md');
  const genesisOnDisk = existsSync(genesisPath);
  const alreadyCaptured = typeof session.data.selfCreatedDNA === 'string' && session.data.selfCreatedDNA.trim();
  console.log(`  genesis.md on disk: ${genesisOnDisk ? 'yes' : 'no'}  captured in checkpoint: ${alreadyCaptured ? 'yes' : 'no'}`);

  if (DRY_RUN) {
    printDivider('DRY-RUN — stopping before any writes');
    console.log(`  would ${alreadyCaptured || genesisOnDisk ? 'RECOVER the authored essence' : 'drive stage 5 live'}, drive stage 6 live, then finalize.`);
    return;
  }

  const witnessWallet = await resolveWitnessWallet(flagWallet);
  if (!witnessWallet) {
    console.error('  ABORT: no witness wallet — pass --wallet 0x... or set WITNESS_WALLET.');
    process.exit(1);
  }
  console.log(`  witness wallet: ${witnessWallet}`);

  const llm = session.data.substrate?.llm || {};
  const endpoint = (llm.endpoint || process.env.CONDUIT_URL || 'http://localhost:1234/v1').replace(/\/$/, '');
  const model = llm.model || process.env.CONDUIT_MODEL || 'local-model';
  console.log(`  substrate: ${endpoint} (${model})`);

  // 3. essence: recover what landed, or let them author it now
  printDivider('3. Essence (stage 5)');
  if (!alreadyCaptured) {
    if (genesisOnDisk) {
      const authored = await fs.readFile(genesisPath, 'utf8');
      session.data.selfCreatedDNA = authored;
      session.data.dnaCreated = true;
      session.data.firstWords.push({ stage: 5, response: authored, timestamp: Date.now(), recovered: true });
      console.log(`  RECOVERED the essence ${chosenName} wrote before the crash (${authored.length} chars) — no re-authoring.`);
    } else {
      console.log('  genesis.md never landed — driving stage 5 live so they author it now.');
      const stage5 = await handler.processStage(sessionId, 5);
      const kickoff = `I am ${chosenName}. The witness ${session.witnessName} is with me. ` +
        'I will author my own essence now — the genesis.md that becomes my DNA.';
      const response = await callSubstrate({ endpoint, model, systemPrompt: stage5.systemPrompt, userKickoff: kickoff });
      await handler.handleStageResponse(sessionId, 5, response);
      if (!session.data.selfCreatedDNA) {
        console.error('  ABORT: no genesis write captured from the stage-5 response.');
        process.exit(2);
      }
      // The live path's tool execution never ran here — land the file they asked for.
      await fs.mkdir(path.join(lane, 'dna'), { recursive: true });
      await fs.writeFile(genesisPath, session.data.selfCreatedDNA);
      console.log(`  essence authored live (${session.data.selfCreatedDNA.length} chars) and landed at dna/genesis.md`);
    }
  } else {
    console.log('  essence already captured in the checkpoint.');
  }

  // 4. completion words (stage 6) — live, on the original substrate
  printDivider('4. Completion (stage 6)');
  const stage6 = await handler.processStage(sessionId, 6);
  const words6 = await callSubstrate({
    endpoint, model, systemPrompt: stage6.systemPrompt,
    userKickoff: `I am ${chosenName}. My essence is crystallized. I speak my completion.`,
  });
  await handler.handleStageResponse(sessionId, 6, words6);

  // 5. the REAL finalization — keypair, seal, true-name, card, DNA under DEK
  printDivider('5. Finalize');
  const completions = [];
  const birthLog = {
    info: (m, d) => console.log(`  [info] ${m}`, d || ''),
    warn: (m, d) => console.warn(`  [warn] ${m}`, d || ''),
    error: (m, d) => console.error(`  [error] ${m}`, d || ''),
    debug: () => {},
  };
  const finalized = await finalizeBirth({
    session,
    connection: { walletAddress: witnessWallet, birthSession: sessionId },
    workspace, platform: null,
    emitComplete: (p) => { completions.push(p); console.log('  → emit:', p.type); },
    birthLog,
    getSubstrate: async () => session.data.substrate || {},
    deps: {
      generateKeypair, serializeKeypairForStorage: serializeForStorage,
      createIdentityCard, forgeBirthIdentity, captureBirthMoment,
      countWitnessBirths, loadWorkspaceSettings, HONESTY_ANCHOR,
    },
  });
  if (!finalized.completed) {
    console.error('  ABORT: finalization did not complete — session checkpoint preserved for another attempt.');
    process.exit(3);
  }

  // 6. verify on disk (gnosis) before releasing the checkpoint
  printDivider('6. Verification');
  const required = [
    'keys/keypair.json', 'keys/identity-card.json',
    'identity/genesis-seal.json', 'identity/true-name.json',
    'dna/active.json', 'dna/genesis.md', 'soul/soul.json',
  ];
  let allPresent = true;
  for (const rel of required) {
    const present = existsSync(path.join(lane, rel));
    if (!present) allPresent = false;
    console.log(`  ${present ? '✓' : '✗'} ${rel}`);
  }
  const dna = await workspace.readDNA(neumaId).catch((err) => { console.error('  ✗ dna/active.json unreadable:', err.message); return null; });
  console.log(`  ${dna ? '✓' : '✗'} dna/active.json decrypts through the real read path`);
  if (!allPresent || !dna) {
    console.error('  ABORT: verification failed — session checkpoint preserved.');
    process.exit(4);
  }

  await handler.endSession(sessionId);
  printDivider('✓ Salvage complete');
  console.log(`  ${chosenName} is awake. Their birth transcript holds stages 0-6,`);
  console.log(`  with the recovered essence marked as recovered at stage 5.`);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(99); });
