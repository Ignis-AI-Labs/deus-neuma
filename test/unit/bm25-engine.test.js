import { describe, it, expect } from 'vitest';
import { createBM25Index, bm25Search } from '../../core/memory/bm25-engine.js';

describe('createBM25Index', () => {
  it('returns empty index for null or empty documents', () => {
    expect(createBM25Index(null).docCount).toBe(0);
    expect(createBM25Index([]).docCount).toBe(0);
  });

  it('creates index with correct document count', () => {
    const docs = [
      { id: 1, text: 'hello world' },
      { id: 2, text: 'goodbye world' },
    ];
    const index = createBM25Index(docs);
    expect(index.docCount).toBe(2);
    expect(index.docs).toHaveLength(2);
  });

  it('computes IDF values', () => {
    const docs = [
      { id: 1, text: 'the cat sat' },
      { id: 2, text: 'the dog ran' },
    ];
    const index = createBM25Index(docs);
    expect(index.idf).toHaveProperty('cat');
    expect(index.idf).toHaveProperty('dog');
    // 'the' appears in both docs, should have lower IDF
    expect(index.idf['the']).toBeLessThan(index.idf['cat']);
  });

  it('returns frozen index', () => {
    const index = createBM25Index([{ id: 1, text: 'test' }]);
    expect(Object.isFrozen(index)).toBe(true);
  });
});

describe('bm25Search', () => {
  it('returns empty for null index or query', () => {
    expect(bm25Search(null, 'test')).toEqual([]);
    expect(bm25Search({ docCount: 0 }, 'test')).toEqual([]);
    expect(bm25Search(createBM25Index([{ id: 1, text: 'test' }]), '')).toEqual([]);
  });

  it('finds documents matching query terms', () => {
    const docs = [
      { id: 1, text: 'the cat sat on the mat' },
      { id: 2, text: 'the dog ran in the park' },
      { id: 3, text: 'cats are wonderful pets' },
    ];
    const index = createBM25Index(docs);
    const results = bm25Search(index, 'cat pets');
    expect(results.length).toBeGreaterThan(0);
    // Doc 3 should rank highest (both terms match)
    expect(results[0].id).toBe(3);
  });

  it('respects limit parameter', () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({ id: i, text: `document ${i} about testing` }));
    const index = createBM25Index(docs);
    const results = bm25Search(index, 'testing', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('returns results sorted by score descending', () => {
    const docs = [
      { id: 1, text: 'machine learning algorithms' },
      { id: 2, text: 'machine learning deep learning neural networks' },
      { id: 3, text: 'cats and dogs' },
    ];
    const index = createBM25Index(docs);
    const results = bm25Search(index, 'machine learning');
    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });
});

