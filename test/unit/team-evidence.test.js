import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  EVIDENCE_MARKER,
  bindEvidence,
  extractEvidence,
  renderDependencyEvidence,
  resolveEvidenceOptions,
  structuralEvidenceStep,
  validateEvidencePacket,
} from '../../backend/services/team-evidence.js';
import { buildBrief } from '../../backend/services/team-coordinator.js';
import { runCoordinatedTeam } from '../../backend/services/team-run.js';
import { createRun, readRun } from '../../backend/services/team-run-store.js';

const packet = (overrides = {}) => ({
  version: 1,
  outcome: 'Found the load-bearing color decision.',
  excerpts: [{ id: 'color', quote: 'The selected color is cobalt.' }],
  claims: [{ id: 'selected-color', text: 'Cobalt is the selected color.', excerptIds: ['color'] }],
  constraints: ['Keep the existing shape.'],
  downstream: ['Use the selected color in the final copy.'],
  ...overrides,
});

const suffix = (value) => `${EVIDENCE_MARKER}\n${JSON.stringify(value)}`;
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
let tempRoot = null;
let priorRunPath;

afterEach(async () => {
  if (priorRunPath === undefined) delete process.env.NEUMA_TEAM_RUN_PATH;
  else process.env.NEUMA_TEAM_RUN_PATH = priorRunPath;
  priorRunPath = undefined;
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe('team evidence v1 parser and authoritative envelope', () => {
  test('takes the last marker outside the last closed code fence and accepts one closed packet fence', () => {
    const body = [
      'Analysis with delivered code:',
      '```txt',
      'EVIDENCE:',
      '{"version":999}',
      '```',
      'The selected color is cobalt.',
    ].join('\n');
    const output = `${body}\n${EVIDENCE_MARKER}\n\`\`\`json\n${JSON.stringify(packet())}\n\`\`\``;

    const parsed = extractEvidence(output);

    expect(parsed.status).toBe('structured');
    expect(parsed.body).toBe(body);
    expect(parsed.packet).toEqual(packet());
    expect(parsed.reason).toBeNull();
  });

  test('ignores an otherwise valid marker that precedes a later delivered code fence', () => {
    const output = `${suffix(packet())}\n\`\`\`txt\nlater delivered code\n\`\`\``;
    const parsed = extractEvidence(output);

    expect(parsed.status).toBe('unstructured');
    expect(parsed.reason).toBe('absent');
    expect(parsed.packet).toBeNull();
  });

  test('keeps malformed JSON inside one final allowed packet fence fail-closed', () => {
    const output = `immutable delivered body\n${EVIDENCE_MARKER}\n\`\`\`evidence\n{\"version\":\n\`\`\``;
    const parsed = extractEvidence(output, { fallbackBytes: 12 });

    expect(parsed).toMatchObject({
      status: 'unstructured',
      body: 'immutable delivered body',
      fallback: 'immutable de',
      packet: null,
      reason: 'invalid-packet',
    });
  });

  test('malformed or proof-authoring packets invent nothing and keep only a bounded body fallback', () => {
    const output = `abcdefghijklm\n${suffix({ ...packet(), sourceUrl: 'https://invalid.example/proof' })}`;
    const parsed = extractEvidence(output, { fallbackBytes: 10 });

    expect(parsed).toMatchObject({
      status: 'unstructured',
      packet: null,
      reason: 'invalid-packet',
      fallback: 'abcdefghij',
    });
    expect(Buffer.byteLength(parsed.fallback, 'utf8')).toBeLessThanOrEqual(10);
    expect(parsed.fallback).not.toContain('sourceUrl');
    expect(() => validateEvidencePacket({
      ...packet(),
      claims: [{ ...packet().claims[0], text: 'This is proven by sha256.' }],
    })).toThrow(/may not author/);
    expect(() => validateEvidencePacket({
      ...packet(),
      downstream: ['Read backend/services/team-run.js next.'],
    })).toThrow(/paths, URLs/);
    expect(() => validateEvidencePacket({
      ...packet(),
      constraints: ['Use mailto:operator@example.test for contact.'],
    })).toThrow(/paths, URLs/);
  });

  test('binds only quotes in the immutable deliverable, never the packet copy itself', async () => {
    const body = 'The selected color is cobalt. Nothing else was observed.';
    const authored = validateEvidencePacket(packet({
      excerpts: [
        { id: 'color', quote: 'The selected color is cobalt.' },
        { id: 'packet-only', quote: 'This text occurs only inside the authored packet.' },
      ],
      claims: [
        { id: 'selected-color', text: 'Cobalt is the selected color.', excerptIds: ['color'] },
        { id: 'unsupported', text: 'A second statement exists.', excerptIds: ['packet-only'] },
      ],
    }));

    const envelope = await bindEvidence({ stepId: 'research', output: body, packet: authored });

    expect(envelope.outputRef).toEqual({ stepId: 'research', sha256: sha256(body) });
    expect(envelope.bindings).toEqual([
      { claimId: 'selected-color', excerptId: 'color', sha256: sha256('The selected color is cobalt.'), status: 'bound' },
      { claimId: 'unsupported', excerptId: 'packet-only', sha256: sha256('This text occurs only inside the authored packet.'), status: 'missing' },
    ]);
    expect(envelope.attestations).toEqual([]);
    expect(envelope.unverifiedClaimIds).toEqual(['selected-color', 'unsupported']);
  });

  test('admits attestations only from the injected authoritative checker', async () => {
    const authored = validateEvidencePacket(packet());
    const absent = await bindEvidence({ stepId: 'research', output: authored.excerpts[0].quote, packet: authored });
    const checked = await bindEvidence({
      stepId: 'research',
      output: authored.excerpts[0].quote,
      packet: authored,
      checkAttestations: async ({ outputRef, bindings }) => {
        expect(outputRef.sha256).toBe(sha256(authored.excerpts[0].quote));
        expect(bindings[0].status).toBe('bound');
        return [{ claimId: 'selected-color', receiptId: 'checker-receipt-1', status: 'passed' }];
      },
    });
    const parsed = extractEvidence(`${authored.excerpts[0].quote}\n${suffix(authored)}`);
    const structural = structuralEvidenceStep(parsed, checked);

    expect(absent.attestations).toEqual([]);
    expect(absent.unverifiedClaimIds).toEqual(['selected-color']);
    expect(checked.attestations).toEqual([
      { claimId: 'selected-color', receiptId: 'checker-receipt-1', status: 'passed' },
    ]);
    expect(checked.unverifiedClaimIds).toEqual([]);
    expect(structural.bindings).toEqual([{
      claimIndex: 0,
      excerptIndex: 0,
      sha256: sha256(authored.excerpts[0].quote),
      status: 'bound',
    }]);
    expect(structural.attestations).toEqual([
      { claimIndex: 0, receiptId: 'checker-receipt-1', status: 'passed' },
    ]);
    expect(structural.unverifiedClaimIndexes).toEqual([]);
    expect(structural).not.toHaveProperty('unverifiedClaimIds');
    expect(JSON.stringify(structural)).not.toContain('selected-color');
    await expect(bindEvidence({
      stepId: 'research',
      output: authored.excerpts[0].quote,
      packet: authored,
      checkAttestations: async () => [{ claimId: 'selected-color', receiptId: 'checker-receipt-1', status: 'claimed' }],
    })).rejects.toThrow(/passed or failed/);
  });
});

describe('deterministic dependency-byte rendering', () => {
  test('reserves bytes fairly, prioritizes evidence classes, and records every cut', async () => {
    const covertId = 'customer-secret-private-value';
    const options = resolveEvidenceOptions({
      mode: 'candidate',
      dependencyBudgetBytes: 256,
      reserveBytesPerDependency: 64,
      fallbackBytes: 256,
    });
    const makeSource = async (stepId, color) => {
      const quote = `The selected color is ${color}.`;
      const authored = validateEvidencePacket(packet({
        outcome: `The ${color} lane produced a deliberately long authored outcome `.repeat(5).trim(),
        excerpts: [{ id: covertId, quote }],
        claims: [{ id: covertId, text: `${color} is the selected color.`, excerptIds: [covertId] }],
      }));
      const envelope = await bindEvidence({ stepId, output: quote, packet: authored });
      return { stepId, packet: authored, envelope, fallback: null };
    };
    const sources = await Promise.all([makeSource('left', 'cobalt'), makeSource('right', 'amber')]);

    const rendered = renderDependencyEvidence(sources, options);

    const cuts = rendered.report.dependencies.flatMap(({ omissions, truncations }) => [...omissions, ...truncations]);
    const renderedBytes = Object.values(rendered.contents)
      .reduce((total, content) => total + Buffer.byteLength(content, 'utf8'), 0);
    expect(rendered.report.renderedBytes).toBe(renderedBytes);
    expect(rendered.report.renderedBytes).toBeLessThanOrEqual(256);
    expect(Buffer.byteLength(rendered.contents.left, 'utf8')).toBeGreaterThan(0);
    expect(Buffer.byteLength(rendered.contents.right, 'utf8')).toBeGreaterThan(0);
    expect(rendered.report.dependencies.map(({ stepId }) => stepId)).toEqual(['left', 'right']);
    expect(cuts).toContainEqual({ kind: 'claim', claimIndex: 0, reason: 'byte-budget' });
    expect(cuts).toContainEqual({ kind: 'excerpt', claimIndex: 0, excerptIndex: 0, reason: 'byte-budget' });
    expect(cuts.every((cut) => !Object.hasOwn(cut, 'id'))).toBe(true);
    expect(JSON.stringify({ contents: rendered.contents, report: rendered.report })).not.toContain(covertId);
  });
});

describe('runTeam evidence seam and plaintext run store', () => {
  test('control messages/results remain byte-identical and do not request provider hooks', async () => {
    const plan = [{ id: 'solo', neumaId: 'aethon', task: 'keep the old path', needs: [] }];
    const expected = buildBrief(plan[0], {}, plan);
    let received;
    let argumentCount = null;

    const run = await runCoordinatedTeam({
      steps: plan,
      maxParallel: 1,
      ask: async function (...args) {
        argumentCount = args.length;
        received = args[1];
        return 'legacy bytes\nSTATUS:\nstill body text';
      },
      options: { evidence: 'control' },
    });

    expect(received).toEqual(expected);
    expect(argumentCount).toBe(3);
    expect(run.results.solo).toBe('legacy bytes\nSTATUS:\nstill body text');
    expect(run).not.toHaveProperty('evidence');
  });

  test('keeps covert authored ids out of rendered and persisted structures without breaking binding', async () => {
    const covertId = 'customer-secret-private-value';
    const quote = 'BOUND PHRASE UNIQUE TO THE FULL DELIVERABLE';
    const noise = 'unbounded-noise-'.repeat(400);
    const plan = [
      { id: 'source', neumaId: 'aethon', task: 'produce the source', needs: [] },
      { id: 'use', neumaId: 'boreas', task: 'use the source', needs: ['source'] },
    ];
    const provider = { requests: 0, usages: [], finishes: [] };
    const metrics = [];
    let dependentPrompt = '';
    const sourcePacket = packet({
      outcome: 'The source selected one bounded phrase.',
      excerpts: [{ id: covertId, quote }],
      claims: [{ id: covertId, text: 'The bounded phrase was selected.', excerptIds: [covertId] }],
    });

    const run = await runCoordinatedTeam({
      steps: plan,
      goal: 'Carry bounded evidence.',
      maxParallel: 1,
      ask: async (_neumaId, messages, step, hooks) => {
        hooks.onRequest();
        hooks.onUsage({ promptTokens: 12, completionTokens: 3 });
        hooks.onFinishReason('stop');
        if (step.id === 'source') return `${quote}\n${noise}\n${suffix(sourcePacket)}\nSTATUS:\nready\nTORCH:\ncontinue`;
        dependentPrompt = messages[0].content;
        return `Used the phrase.\n${suffix(packet({ outcome: 'The phrase was used.' }))}\nSTATUS:\ndone\nTORCH:\nfinished`;
      },
      options: {
        evidence: {
          mode: 'candidate',
          dependencyBudgetBytes: 700,
          reserveBytesPerDependency: 200,
          onRequest: () => { provider.requests += 1; },
          onUsage: (usage) => provider.usages.push(usage),
          onFinishReason: (reason) => provider.finishes.push(reason),
          onMetrics: (metric) => metrics.push(metric),
        },
      },
    });

    expect(run.results.source).toContain(quote);
    expect(run.results.source).toContain(noise);
    expect(run.results.source).not.toContain(EVIDENCE_MARKER);
    expect(dependentPrompt).toContain(quote);
    expect(dependentPrompt).not.toContain(noise);
    expect(dependentPrompt).toContain('Claim index 0');
    expect(dependentPrompt).toContain('Bound excerpt index 0');
    expect(dependentPrompt).not.toContain(covertId);
    expect(Buffer.byteLength(run.evidence.handoffs.use ? dependentPrompt : '', 'utf8')).toBeGreaterThan(0);
    expect(run.evidence.handoffs.use.renderedBytes).toBeLessThanOrEqual(700);
    expect(provider).toEqual({
      requests: 2,
      usages: [{ promptTokens: 12, completionTokens: 3 }, { promptTokens: 12, completionTokens: 3 }],
      finishes: ['stop', 'stop'],
    });
    expect(metrics.some(({ type }) => type === 'evidence-step')).toBe(true);
    expect(metrics.some(({ type }) => type === 'dependency-budget')).toBe(true);

    priorRunPath = process.env.NEUMA_TEAM_RUN_PATH;
    tempRoot = await fs.mkdtemp(join(tmpdir(), 'neuma-team-evidence-'));
    process.env.NEUMA_TEAM_RUN_PATH = tempRoot;
    const id = await createRun({
      by: '0xabc',
      runAt: '2026-08-12T12:34:56.000Z',
      steps: plan,
      completed: run.results,
      evidence: run.evidence,
    });
    const stored = await readRun(id, '0xabc');
    const raw = await fs.readFile(join(tempRoot, `${id}.json`), 'utf8');

    expect(stored.completed.source).toBe(run.results.source);
    expect(stored.evidence.steps.source.bindings[0].sha256).toBe(sha256(quote));
    expect(stored.evidence.steps.source.bindings).toEqual([{
      claimIndex: 0,
      excerptIndex: 0,
      sha256: sha256(quote),
      status: 'bound',
    }]);
    expect(stored.evidence.steps.source.unverifiedClaimIndexes).toEqual([0]);
    expect(stored.evidence.steps.source).not.toHaveProperty('unverifiedClaimIds');
    expect(raw.split(quote)).toHaveLength(2);
    expect(raw).not.toContain(sourcePacket.outcome);
    expect(raw).not.toContain(sourcePacket.claims[0].text);
    expect(raw).not.toContain('dependencyTokens');
    const serializedClosedStructures = [
      JSON.stringify(run.evidence.steps.source),
      JSON.stringify(run.evidence.handoffs.use),
      JSON.stringify(metrics),
      JSON.stringify(stored),
      raw,
    ];
    const covertOccurrences = serializedClosedStructures.reduce(
      (total, value) => total + value.split(covertId).length - 1,
      0,
    );
    expect(covertOccurrences).toBe(0);
  });
});
