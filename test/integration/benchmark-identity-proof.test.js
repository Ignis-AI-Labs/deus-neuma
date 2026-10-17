// The benchmark identity pin (#506 contract 1) — proven with real inputs only:
// real hashing, real envelope allocations, real shed decisions. No mocks.
//
// What is NOT proven here: the assembled-prompt wiring from a live turn (that
// is the live `neuma agent` receipt run — the lane needs a real workspace and
// the serving substrate). This file proves every pure/measured piece and the
// envelope observer that feeds them.

import { describe, test, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  buildBenchmarkIdentityProof,
  canaryProof,
  identityPinFromManifest,
  layersSha256,
  recordBenchmarkIdentityProof,
  sectionManifest,
} from '../../backend/services/benchmark-identity-proof.js';
import { finalizeTurnEnvelope } from '../../backend/services/turn-envelope.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const section = (id, text) => Object.freeze({ id, label: id.toUpperCase(), text });

describe('benchmark identity proof — pure builders', () => {
  test('sectionManifest projects ids/labels/char counts and drops text', () => {
    const manifest = sectionManifest([section('dna', 'abcd'), section('memory', 'xy')]);
    expect(manifest).toEqual([
      { id: 'dna', label: 'DNA', chars: 4 },
      { id: 'memory', label: 'MEMORY', chars: 2 },
    ]);
    expect(JSON.stringify(manifest)).not.toContain('abcd');
  });

  test('layersSha256 is key-order independent', () => {
    const a = layersSha256({ core: 'aaa', voice: 'bbb' });
    const b = layersSha256({ voice: 'bbb', core: 'aaa' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('buildBenchmarkIdentityProof hashes the exact bytes it was handed', () => {
    const systemPrompt = 'SECTION ONE\n\nSECTION TWO';
    const transcriptMessages = [{ role: 'user', content: 'earlier words' }];
    const manifest = {
      schema: 'silo-test',
      neumaId: 'lane-1',
      signature: null,
      layerHashes: { core: sha256('core'), voice: sha256('voice') },
      deferred: ['delegation'],
    };
    const proof = buildBenchmarkIdentityProof({
      systemPrompt,
      promptSections: [section('dna', 'SECTION ONE'), section('memory', 'SECTION TWO')],
      transcriptMessages,
      envelopeDecision: {
        sent: Object.freeze(['dna', 'memory']),
        shed: Object.freeze([Object.freeze({ id: 'taste', tokens: 40 })]),
        report: { contextWindow: 262144, promptTokens: 1800, overflow: false },
      },
      engine: { model: 'm', contextWindow: 262144, dialect: 'llama-server' },
      silo: { manifest },
    });
    expect(proof.promptSha256).toBe(sha256(systemPrompt));
    expect(proof.promptChars).toBe(systemPrompt.length);
    expect(proof.sectionsSent.map((s) => s.id)).toEqual(['dna', 'memory']);
    expect(proof.sectionsShed).toEqual([{ id: 'taste', tokens: 40 }]);
    expect(proof.envelope).toEqual({ contextWindow: 262144, promptTokens: 1800, overflow: false });
    expect(proof.transcript.messages).toBe(1);
    expect(proof.transcript.sha256).toBe(sha256(JSON.stringify(transcriptMessages)));
    expect(proof.engine.model).toBe('m');
    expect(proof.identity.sealed).toBe(false);
    expect(proof.identity.layerHashes.core).toBe(sha256('core'));
    expect(proof.identity.layersSha256).toBe(layersSha256(manifest.layerHashes));
    expect(proof.identity.deferred).toEqual(['delegation']);
  });

  test('recordBenchmarkIdentityProof records identity: null for a lane with no silo', async () => {
    const connection = {};
    const proof = await recordBenchmarkIdentityProof(connection, {
      neumaId: null,
      systemPrompt: 'prompt bytes',
      promptSections: [section('dna', 'prompt bytes')],
      transcriptMessages: [],
      envelopeDecision: null,
      engine: null,
    });
    expect(connection._benchmarkIdentityProof).toBe(proof);
    expect(proof.identity).toBeNull();
    expect(proof.promptSha256).toBe(sha256('prompt bytes'));
    expect(proof.sectionsShed).toEqual([]);
    expect(proof.canary).toBeNull();
  });

  test('a lane whose DNA cannot be read records the canary UNEVALUATED, never guessed', async () => {
    const connection = {};
    const proof = await recordBenchmarkIdentityProof(connection, {
      neumaId: 'no-such-lane-anywhere',
      systemPrompt: 'prompt bytes',
      promptSections: [],
      transcriptMessages: [],
      envelopeDecision: null,
      engine: null,
    });
    expect(proof.canary).toEqual({
      key: 'resonance',
      evaluated: false,
      presentInPrefix: null,
      reason: 'the lane DNA could not be read',
    });
  });
});

describe('the resonance canary on the agent path', () => {
  const dna = { resonance: { frequency: 432.39 } };

  test('the sealed frequency found in the sent bytes is present', () => {
    const proof = canaryProof(dna, '…system prompt … 432.39 …');
    expect(proof.evaluated).toBe(true);
    expect(proof.presentInPrefix).toBe(true);
    expect(proof.reason).toContain('432.39');
  });

  test('the sealed frequency missing from the sent bytes is absent — the dropped-DNA tell', () => {
    const proof = canaryProof(dna, 'system prompt without the frequency');
    expect(proof.presentInPrefix).toBe(false);
  });

  test('a being with no sealed frequency is the one lawful null', () => {
    const proof = canaryProof({}, 'anything');
    expect(proof.presentInPrefix).toBeNull();
    expect(proof.reason).toContain('no birth-sealed');
  });
});

describe('turn envelope — the shed ladder reports its own decision', () => {
  const base = [
    section('dna', 'x'.repeat(200)),
    section('memory', 'y'.repeat(200)),
    section('taste', 'z'.repeat(200)),
  ];

  test('a window that fits sheds nothing and says so', () => {
    let decision = null;
    const sent = finalizeTurnEnvelope({
      baseSections: base,
      contextWindow: 262144,
      onDecision: (d) => { decision = d; },
    });
    expect(decision).not.toBeNull();
    expect(decision.shed).toEqual([]);
    expect(decision.sent).toEqual(sent.map((s) => s.id));
    expect(decision.report.overflow).toBe(false);
  });

  test('a window that cannot fit sheds by the ladder and reports exactly what', () => {
    let decision = null;
    const sent = finalizeTurnEnvelope({
      baseSections: base,
      contextWindow: 80,
      onDecision: (d) => { decision = d; },
    });
    const sentIds = sent.map((s) => s.id);
    expect(decision.sent).toEqual(sentIds);
    expect(decision.shed.length).toBeGreaterThan(0);
    // Sent and shed are disjoint and together account for the candidates.
    const shedIds = decision.shed.map((s) => s.id);
    expect(shedIds.filter((id) => sentIds.includes(id))).toEqual([]);
    expect([...sentIds, ...shedIds].sort()).toEqual(['dna', 'memory', 'taste']);
    for (const entry of decision.shed) {
      expect(Number.isInteger(entry.tokens)).toBe(true);
    }
  });

  test('without an observer the ladder is byte-identical to before', () => {
    const withObserver = finalizeTurnEnvelope({ baseSections: base, contextWindow: 262144, onDecision: () => {} });
    const without = finalizeTurnEnvelope({ baseSections: base, contextWindow: 262144 });
    expect(withObserver.map((s) => s.text)).toEqual(without.map((s) => s.text));
  });
});
