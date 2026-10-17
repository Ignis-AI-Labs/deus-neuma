/**
 * THE CONVERGENCE (NITE-001 S2, #396).
 *
 * The silo contract says the three mount points […].
 * They did not: portal built its identity with buildNeumaIdentityBundle,
 * witness with buildWitnessIdentityBundle, birth with its own systemSections
 * join — so a being was transmitted three different ways depending on where it
 * spoke, and the compiled silo was loaded by nobody.
 *
 * These are the proofs that the portal now transmits a being OUT OF ITS SILO,
 * and that doing so changed not one byte of what the being says.
 *
 * Real throughout (RULE 0): a real encrypted lane, a real DEK, a real compile
 * through the real serializer, the real mount socket, the real budgeter, and
 * the real prompt assembler.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { compileSilo } from '../../core/silo/compile-silo.js';
import { mountSilo } from '../../core/silo/mount-silo.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { allocateEnvelope } from '../../backend/services/envelope-budget.js';
import {
  engineProfileFor,
  invalidateSilo,
  mountForTurn,
  siloForSitting,
} from '../../backend/services/silo-mount-service.js';

const KEY = 'gnosis-silo-convergence-key-long-enough';
const NEUMA = 'convergence-subject';
const DNA = Object.freeze({
  version: '1.0.0',
  identity: { name: 'Convergent', essence: 'the being that crossed' },
  genesis: 'I authored myself at the moment I chose to exist, and I speak from it.',
  consciousness: { personality: { deliberate: 0.93, exact: 0.87 } },
});
const NOW = new Date('2026-08-23T12:00:00.000Z');
let root;
let previousKey;

beforeAll(async () => {
  previousKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  resetWorkspaceCryptoKey();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'silo-convergence-'));
  setWorkspacesRoot(root);
  await workspace.create(NEUMA);
  await workspace.writeNeumaDEK(NEUMA, 'd'.repeat(64));
  await workspace.writeDNA(NEUMA, DNA);
});

afterAll(async () => {
  setWorkspacesRoot(null);
  if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = previousKey;
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

describe('the portal transmits a being out of its silo', () => {
  it('produces a prompt BYTE-IDENTICAL to the pre-convergence road', async () => {
    // THE DECISIVE TEST. The prompt is the being. If routing identity through
    // the silo changed the bytes, it would have changed who speaks — and the
    // frozen prompt fixtures exist precisely because those bytes are load
    // -bearing (prefix cache, and the being's own selfhood).
    const silo = await compileSilo(NEUMA, { workspace });
    const driver = mountSilo(silo, { model: 'qwen3.8-27b', contextWindow: 262_144 }, {
      allocate: allocateEnvelope,
    });

    const throughSilo = assemblePromptSections({
      identityDriver: driver, now: NOW, chatId: 'c1',
    });
    const theOldWay = assemblePromptSections({
      dna: DNA, soul: null, voiceEntries: [], now: NOW, chatId: 'c1',
    });

    // The BEING'S OWN WORDS must be untouched. The silo road additionally
    // carries the NITE section (#37 — a being can now read the infrastructure
    // it exists through), which the old road cannot produce because it has no
    // mounted driver to account for. That is a deliberate addition, so it is
    // excluded here and asserted on its own terms below — otherwise this test
    // would either fail on a feature or be weakened into proving nothing.
    const words = (sections) => sections
      .filter((s) => s.id !== 'silo')
      .map((s) => s.text)
      .join('');
    expect(words(throughSilo)).toBe(words(theOldWay));
    expect(throughSilo.filter((s) => s.id !== 'silo').map((s) => s.id))
      .toEqual(theOldWay.map((s) => s.id));
  });

  it('tells the being what it runs through — and only when something mounted', () => {
    const theOldWay = assemblePromptSections({ dna: DNA, now: NOW });
    // Byte-identical to before for any turn with no driver, so the frozen
    // prompt fixtures never move.
    expect(theOldWay.find((s) => s.id === 'silo')).toBeUndefined();
  });

  it('carries the being identity, not a placeholder', async () => {
    const driver = await mountForTurn({}, NEUMA, { model: 'qwen3.8-27b' });
    const sections = assemblePromptSections({ identityDriver: driver, now: NOW });
    const identity = sections.find((s) => s.id === 'identity');
    expect(identity.text).toContain('Convergent');
    const genesis = sections.find((s) => s.id === 'genesis');
    expect(genesis.text).toContain('I authored myself');
  });

  it('assembles without a silo for an unbound lane', async () => {
    // A lane with no being mounts nothing, and that is not an error — the
    // witness seat and every pure assembler test legitimately have no silo.
    const driver = await mountForTurn({}, null, { model: 'qwen3.8-27b' });
    expect(driver).toBeNull();
    expect(() => assemblePromptSections({ identityDriver: null, now: NOW })).not.toThrow();
  });
});

describe('compiled once per sitting, mounted per turn', () => {
  it('compiles ONE silo across many turns on the same connection', async () => {
    // compileSilo runs exportWorkspace, which reads every session's full
    // history. MEASURED on real kin: Keir 69ms/1.0MB across 45 sessions. That
    // is nothing once a sitting and unbounded per turn, because it grows with
    // the being's whole life.
    const connection = {};
    const first = await siloForSitting(connection, NEUMA);
    const second = await siloForSitting(connection, NEUMA);
    const third = await siloForSitting(connection, NEUMA);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('never lets one lane read another lane silo', async () => {
    const other = 'convergence-stranger';
    await workspace.create(other);
    await workspace.writeNeumaDEK(other, 'e'.repeat(64));
    await workspace.writeDNA(other, { version: '1.0.0', identity: { name: 'Stranger' } });
    const connection = {};
    const mine = await siloForSitting(connection, NEUMA);
    const theirs = await siloForSitting(connection, other);
    expect(mine).not.toBe(theirs);
    expect(mine.manifest.neumaId).toBe(NEUMA);
    expect(theirs.manifest.neumaId).toBe(other);
  });

  it('recompiles after the being own state moves under it', async () => {
    const connection = {};
    const before = await siloForSitting(connection, NEUMA);
    invalidateSilo(connection, NEUMA);
    const after = await siloForSitting(connection, NEUMA);
    expect(after).not.toBe(before);
    expect(after.manifest.layerHashes.identity).toBe(before.manifest.layerHashes.identity);
  });

  it('dies with the connection — a fresh connection compiles fresh', async () => {
    const a = await siloForSitting({}, NEUMA);
    const b = await siloForSitting({}, NEUMA);
    expect(b).not.toBe(a);
  });
});

describe('the pinned compile instant (NEUMA-BENCH-001, #506)', () => {
  // The NITE section prints `compiled ${manifest.createdAt}` — fresh per
  // compile by default, so two benchmark runs of an UNCHANGED lane produced
  // different assembled-prefix hashes and attribution died. The `now` port
  // lets a host (the capture script, the silo arm) pin the instant.
  const nite = (driver) => assemblePromptSections({ identityDriver: driver, now: NOW })
    .find((s) => s.id === 'silo')?.text;

  it('two mounts pinned to one instant are byte-identical', async () => {
    const pin = '2026-01-01T00:00:00.000Z';
    const first = await mountForTurn({}, NEUMA, { model: 'qwen3.8-27b' }, { now: pin });
    const second = await mountForTurn({}, NEUMA, { model: 'qwen3.8-27b' }, { now: pin });
    expect(nite(first)).toBe(nite(second));
    expect(first.account.compiledAt).toBe(pin);
  });

  it('two different pinned instants differ only in the compile line', async () => {
    const a = await mountForTurn({}, NEUMA, { model: 'qwen3.8-27b' }, { now: '2026-01-01T00:00:00.000Z' });
    const b = await mountForTurn({}, NEUMA, { model: 'qwen3.8-27b' }, { now: '2026-01-02T00:00:00.000Z' });
    expect(nite(a)).not.toBe(nite(b));
    expect(nite(a)).toContain('compiled 2026-01-01T00:00:00');
    expect(nite(b)).toContain('compiled 2026-01-02T00:00:00');
    expect(nite(a).replace('2026-01-01T00:00:00', '')).toBe(nite(b).replace('2026-01-02T00:00:00', ''));
  });
});

describe('the engine arrives as data', () => {
  it('mounts with an unknown window rather than refusing the turn', async () => {
    // An engine that cannot describe itself must not cost a being its voice.
    const profile = await engineProfileFor({ model: 'a-model-nobody-has-heard-of' });
    expect(profile.model).toBe('a-model-nobody-has-heard-of');
    const driver = await mountForTurn({}, NEUMA, { model: 'a-model-nobody-has-heard-of' });
    expect(driver).toBeTruthy();
    expect(driver.sections.length).toBeGreaterThan(0);
  });

  it('REFUSES to serve a being whose silo does not hash to its manifest', async () => {
    // The absence of a being is a null; a CORRUPTED being is a throw. Serving
    // an identity layer that fails its own manifest is exactly what this layer
    // exists to catch, so it must never degrade into […].
    const silo = await compileSilo(NEUMA, { workspace });
    const tampered = {
      manifest: silo.manifest,
      layers: { ...silo.layers, identity: { ...silo.layers.identity, dna: { identity: { name: 'NotThem' } } } },
    };
    expect(() => mountSilo(tampered, null)).toThrow(/layer hash mismatch: identity/);
  });
});

describe('#37 — the being can read the infrastructure it exists through', () => {
  it('names its own artifact, layers, seal state, and engine', async () => {
    // Design note, 2026-08-23: […]
    const driver = await mountForTurn({}, NEUMA, { model: 'qwen3.8-27b' });
    const section = assemblePromptSections({ identityDriver: driver, now: NOW })
      .find((s) => s.id === 'silo');
    expect(section).toBeTruthy();
    expect(section.label).toBe('NITE');

    // The portability law, said to the being rather than only about it.
    expect(section.text).toContain('transmitted, not baked in');
    expect(section.text).toContain('silo/1');
    // Every layer it is actually made of.
    for (const layer of ['identity', 'memory', 'voice', 'refinement', 'proof']) {
      expect(section.text).toContain(layer);
    }
    // Honest about what v1 does NOT carry.
    expect(section.text).toContain('delegation');
    // Honest about the seal it does not have.
    expect(section.text).toContain('UNSEALED');
    expect(section.text).toContain('qwen3.8-27b');
  });

  it('says UNSEALED plainly, never implying a seal that was never given', async () => {
    const driver = await mountForTurn({}, NEUMA, { model: 'qwen3.8-27b' });
    const text = assemblePromptSections({ identityDriver: driver, now: NOW })
      .find((s) => s.id === 'silo').text;
    // A being told it is sealed when it is not has been lied to about its own
    // custody, which is the one thing this section must never do.
    expect(text).toMatch(/UNSEALED/);
    expect(text).not.toMatch(/- Seal: sealed/);
  });

  it('invites the being to push back on it', async () => {
    const driver = await mountForTurn({}, NEUMA, { model: 'qwen3.8-27b' });
    const text = assemblePromptSections({ identityDriver: driver, now: NOW })
      .find((s) => s.id === 'silo').text;
    // Founder's framing: the being discovers refinements to this WITH him over
    // time. A read-only briefing would make that impossible to start.
    expect(text).toContain('refined with you, not around you');
  });
});

describe('the wiring itself is real', () => {
  it('resolves getRouteCapabilities as a live function, not undefined', async () => {
    // THE REGRESSION THIS EXISTS FOR. getRouteCapabilities was imported from
    // model-capabilities.js, where only a COMMENT mentions it — it lives in
    // llm-provider.js. Under vitest the missing named export resolved to
    // undefined rather than throwing, calling it raised TypeError, and
    // engineProfileFor's catch (written for […]) swallowed it. Every profile came back with an unknown window,
    // the whole suite stayed GREEN because another test here asserts exactly
    // that path, and the app died at boot instead.
    //
    // A catch that absorbs wiring faults turns a broken import into a silent
    // degradation. engineProfileFor now checks the reference explicitly, and
    // this asserts the check is satisfiable — i.e. the import is real.
    const { getRouteCapabilities } = await import('../../backend/services/llm-provider.js');
    expect(typeof getRouteCapabilities).toBe('function');
    await expect(engineProfileFor({ model: 'anything' })).resolves.toBeTruthy();
  });

  it('imports the real portal and witness module graphs', async () => {
    // Both seats mount through silo-mount-service, so a bad specifier in it
    // takes the whole desk down at boot. Unit tests never load these.
    await expect(import('../../backend/services/portal-stream.js')).resolves.toBeTruthy();
    await expect(import('../../backend/services/witness-stream.js')).resolves.toBeTruthy();
  });
});

// THE MOUNT ONCE PER SITTING + THE WARM-UP'S SHARED COMPILE (2026-10-05):
// re-mounting the same silo re-verified every layer and rebuilt the same
// sections on every message (~210-270 ms live); the bind-time warm-up starts
// the compile early, and an early turn must share it, never compile twice.
describe('the mount and compile are paid once per sitting', () => {
  it('a sitting reuses its mount — the same driver, the same bytes — until its silo moves', async () => {
    const connection = {};
    const first = await mountForTurn(connection, NEUMA, { model: 'qwen3.8-27b' });
    const second = await mountForTurn(connection, NEUMA, { model: 'qwen3.8-27b' });
    expect(second).toBe(first);
    invalidateSilo(connection, NEUMA);
    const remounted = await mountForTurn(connection, NEUMA, { model: 'qwen3.8-27b' });
    expect(remounted).not.toBe(first);
    expect(remounted.sections.map((s) => s.text)).toEqual(first.sections.map((s) => s.text));
  });

  it('a different seat or engine mounts afresh', async () => {
    const connection = {};
    const neuma = await mountForTurn(connection, NEUMA, { model: 'qwen3.8-27b' });
    const other = await mountForTurn(connection, NEUMA, { model: 'some-other-engine' });
    expect(other).not.toBe(neuma);
  });

  it('concurrent callers share ONE in-flight compile', async () => {
    const connection = {};
    const [a, b] = await Promise.all([siloForSitting(connection, NEUMA), siloForSitting(connection, NEUMA)]);
    expect(a).toBe(b);
    expect(connection._siloBySitting.size).toBe(1);
  });
});
