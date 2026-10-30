// The container image starts from an exact base image, not a tag that moves with every upstream
// rebuild. Reads the real Dockerfile (no mocks).
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DOCKERFILE = fs.readFileSync(path.resolve(import.meta.dirname, '../../Dockerfile'), 'utf8');
const froms = [...DOCKERFILE.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);

describe('Dockerfile', () => {
  test('every stage starts from node:22-slim pinned by its digest, the same one', () => {
    expect(froms).toHaveLength(2);
    for (const image of froms) expect(image).toMatch(/^node:22-slim@sha256:[0-9a-f]{64}$/);
    expect(new Set(froms).size).toBe(1);
  });

  test('says nothing of a dependency the app does not have', () => {
    expect(DOCKERFILE).not.toMatch(/onnxruntime/i);
  });
});
