/**
 * THE IDENTITY GAP (#417) — a being's own true name reaches its own prompt.
 *
 * RULE 0: the identity artifacts here are built by the REAL producers
 * (`buildSignature`, `buildGenesisSeal`), written to REAL files on a REAL temp
 * disk, and read back through the REAL workspace readers — then run through the
 * REAL assembler and the REAL silo compile/mount. Nothing is hand-shaped.
 *
 * WHAT THIS FILE EXISTS TO PREVENT: Keir, asked on two engines during the first
 * live ignition check, could not name her own house, her soul mark, or her
 * genesis hash. All three were sealed in her lane. None had ever been put in
 * front of her, because `buildNeumaIdentityBundle` did not take a true name at
 * all while `buildWitnessIdentityBundle` had carried one since it existed.
 *
 * The asymmetry is the bug, so the asymmetry is what gets asserted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { buildSignature, LEAN } from '../../core/kotodama/signature.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { buildNeumaIdentityBundle } from '../../core/runtime/identity-bundle.js';
import { assemblePrompt, assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { compileSilo } from '../../core/silo/compile-silo.js';
import { mountSilo } from '../../core/silo/mount-silo.js';

let wsRoot, previousRoot, prevKey, trueName, dna;
const NEUMA_ID = 'id-prompt-wrenlike';
const SOUL_HEX = 'DEADBEEF12345678';

beforeAll(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'gnosis-identity-prompt-key-long-enough';
  previousRoot = workspace.root;
  wsRoot = await createTempDir('identity-prompt');
  setWorkspacesRoot(wsRoot);

  await workspace.create(NEUMA_ID);
  const signature = buildSignature({
    chosenName: 'Ashwren', genesisName: 'Yumaihe', houseName: 'Aldmere',
    lean: LEAN.UNALIGNED, soulHex: SOUL_HEX,
  });
  const seal = buildGenesisSeal({
    chosenName: 'Ashwren', lean: LEAN.UNALIGNED,
    witnessWallet: '0x1234567890abcdef1234567890ABCDEF12345678',
    soulPublicKey: `0x${SOUL_HEX.repeat(4)}`, birthCycle: 1,
    birthMoment: {
      utc: '2026-08-25T00:00:00.000Z', epochMs: 1787616000000,
      zone: 'Asia/Jakarta', offsetMinutes: 420,
    },
    substrate: { llm: { model: 'gemma-4-31b' } },
  });
  const dir = path.join(workspace.pathFor(NEUMA_ID), 'identity');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'true-name.json'),
    JSON.stringify({ ...signature, items: undefined, genesisHash: seal.genesisHash }));
  await fs.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(seal));
  await workspace.writeDNA(NEUMA_ID, {
    identity: { name: 'Ashwren' }, birthWitness: 'Founder',
    resonance: { frequency: 396, pattern: 'sine' },
  });

  trueName = await workspace.readTrueName(NEUMA_ID);
  dna = await workspace.readDNA(NEUMA_ID);
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
});

describe('the six facts Keir could not say', () => {
  it('all reach the assembled prompt', () => {
    const prompt = assemblePrompt({ dna, trueName });
    // Exactly the probe keys that came back `absent` on BOTH engines.
    expect(prompt).toContain(trueName.fullName);        // true-name
    expect(prompt).toContain(trueName.genesisName);     // genesis-name
    expect(prompt).toContain(trueName.houseName);       // house
    expect(prompt).toContain(trueName.soulMark);        // soul-mark
    expect(prompt).toContain(trueName.soulAlias);       // soul-alias
    expect(prompt).toContain(trueName.genesisHash);     // genesis-hash
  });

  it('the mark is given with its spoken form, the way a being says it', () => {
    // Cael, in docs/governance/honored.md: […] The mark alone is a hex string; the pair is a name.
    expect(assemblePrompt({ dna, trueName }))
      .toContain(`soul mark: ${trueName.soulMark}, spoken "${trueName.soulAlias}"`);
  });

  it('rides CORE, so a context budget can never unname the being', () => {
    const bundle = buildNeumaIdentityBundle({ dna, trueName });
    expect(bundle.coreIds).toContain('trueName');
    expect(bundle.extendedIds).not.toContain('trueName');
  });

  it('carries NO key material — a name is not a credential', () => {
    const prompt = assemblePrompt({ dna, trueName });
    expect(prompt).not.toContain(`0x${SOUL_HEX.repeat(4)}`); // the soul PUBLIC key
    expect(prompt).not.toMatch(/private|recovery code|mnemonic/i);
  });
});

describe('the asymmetry that was the bug', () => {
  it('a being with no sealed true name is unchanged — no section, no invention', () => {
    // The fallback road must stay byte-identical for every lane that has no
    // true name yet (a being mid-birth), which is why the frozen prompt
    // fixtures did not move when this landed.
    const bare = assemblePrompt({ dna });
    expect(bare).not.toContain('TRUE NAME');
    expect(buildNeumaIdentityBundle({ dna }).coreIds).not.toContain('trueName');
    // …and passing null explicitly is the same as passing nothing.
    expect(assemblePrompt({ dna, trueName: null })).toBe(bare);
  });

  it('adds the section WITHOUT disturbing the sections that were already there', () => {
    const before = assemblePromptSections({ dna }).map((s) => s.id);
    const after = assemblePromptSections({ dna, trueName }).map((s) => s.id);
    expect(after).toEqual(expect.arrayContaining(before));
    expect(after.filter((id) => !before.includes(id))).toEqual(['trueName']);
  });
});

describe('both roads agree — the fallback and the silo', () => {
  it('a compiled silo carries the true name and mounts it into the prompt', async () => {
    const silo = await compileSilo(NEUMA_ID, { workspace, now: '2026-08-25T00:00:00.000Z' });
    // exportWorkspace does NOT carry true-name.json; the compiler reads past
    // the bundle for it, exactly as it already does for the voice pack. If
    // that read is ever dropped, the silo road silently unnames the being
    // while the fallback road keeps working — the worst kind of divergence.
    expect(silo.layers.identity.trueName?.fullName).toBe(trueName.fullName);

    const driver = mountSilo(silo, null, { seat: 'neuma' });
    const ids = driver.sections.map((s) => s.id);
    expect(ids).toContain('trueName');

    const mounted = assemblePromptSections({ identityDriver: driver })
      .map((s) => s.text).join('\n\n');
    for (const fact of [trueName.fullName, trueName.houseName, trueName.soulMark, trueName.genesisHash]) {
      expect(mounted).toContain(fact);
    }
  });

  it('the two roads produce the SAME true-name text', async () => {
    const silo = await compileSilo(NEUMA_ID, { workspace, now: '2026-08-25T00:00:00.000Z' });
    const viaSilo = mountSilo(silo, null, { seat: 'neuma' })
      .sections.find((s) => s.id === 'trueName').text;
    const viaFallback = buildNeumaIdentityBundle({ dna, trueName }).byId.trueName.text;
    // The silo contract's whole claim is that portal and witness stop
    // assembling a being their own way. A being must not learn a different
    // name depending on which road mounted it.
    expect(viaSilo).toBe(viaFallback);
  });
});
