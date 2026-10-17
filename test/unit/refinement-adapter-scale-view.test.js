import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  AdapterRow,
  committedScaleMatches,
  runtimeScaleChoicesFor,
} from '../../frontend/app/RelinkShell/refinement-adapter-scale.jsx';
const SHA256 = 'a'.repeat(64);

const boundAdapter = (approvedScales, selectedScale = 1) => ({
  id: 'prooflet-refinement-1',
  baseModel: 'prooflet-serving',
  scale: 1,
  selectedScale,
  isCurrent: true,
  binding: {
    adapterId: 'prooflet-refinement-1',
    adapterScale: 1,
    approvedScales,
    approvedScalesSha256: SHA256,
  },
});

const renderRow = (adapter) => renderToStaticMarkup(createElement(AdapterRow, {
  neumaId: 'prooflet',
  adapter,
}));

describe('provenance-bound adapter scale control', () => {
  test('offers exactly the approved scales and never invents zero', () => {
    const adapter = boundAdapter([0.5, 1], 0.5);
    expect(adapter.binding.approvedScales).not.toContain(0);
    expect(runtimeScaleChoicesFor(adapter)).toEqual([0.5, 1]);
    expect(renderRow(adapter)).not.toContain('0 · APPROVED BASE ONLY');
    expect(renderRow(adapter)).toContain('EXACTLY APPROVED [0.5 / 1]');
    expect(renderRow(adapter)).not.toContain('type="range"');
  });

  test('retains zero only when the immutable approval explicitly includes it', () => {
    const adapter = boundAdapter([0, 0.5, 1], 0);
    expect(adapter.scale).toBe(1);
    expect(adapter.binding.adapterScale).toBe(1);
    expect(runtimeScaleChoicesFor(adapter)).toEqual([0, 0.5, 1]);
    expect(renderRow(adapter)).toContain('0 · APPROVED BASE ONLY');
  });

  test('offers approved choices for a non-current adapter without inventing a scale', () => {
    const adapter = { ...boundAdapter([0.5, 1], 0), isCurrent: false };
    expect(runtimeScaleChoicesFor(adapter)).toEqual([0.5, 1]);
    const html = renderRow(adapter);
    expect(html).toContain('NOT CURRENT — CHOOSE AN APPROVED SCALE');
    expect(html).not.toContain('0 · APPROVED BASE ONLY');
  });

  test('locks a provenance-bound adapter with incomplete or invalid authority', () => {
    expect(runtimeScaleChoicesFor(boundAdapter([]))).toEqual([]);
    expect(runtimeScaleChoicesFor(boundAdapter([0.5, 1], 0.25))).toEqual([]);
    expect(runtimeScaleChoicesFor(boundAdapter([0.5, 1], 0))).toEqual([]);
    const html = renderRow(boundAdapter([]));
    expect(html).toContain('AUTHORITY INCOMPLETE — LOCKED');
    expect(html).not.toContain('type="range"');
  });

  test('accepts only the exact persisted public adapter revision', () => {
    const adapter = {
      ...boundAdapter([0.5, 1], 0.5),
      sha256: 'b'.repeat(64),
      registeredAt: '2026-08-13T00:00:00.000Z',
      publicationTransactionSha256: 'c'.repeat(64),
      registryGeneration: 4,
      registryAppendRevision: 7,
      registrySha256: 'd'.repeat(64),
      registryCurrentSelectionSha256: 'e'.repeat(64),
    };
    const committed = {
      ...adapter,
      registryGeneration: 5,
      registryAppendRevision: 8,
      registrySha256: 'f'.repeat(64),
      registryCurrentSelectionSha256: '1'.repeat(64),
      selectedScale: 1,
    };
    expect(committedScaleMatches(committed, adapter, 1)).toBe(true);
    expect(committedScaleMatches({
      ...committed,
      binding: { ...committed.binding, approvedScales: [1] },
    }, adapter, 1)).toBe(false);
    const { binding: _binding, ...incomplete } = committed;
    expect(committedScaleMatches(incomplete, adapter, 1)).toBe(false);
  });
});
