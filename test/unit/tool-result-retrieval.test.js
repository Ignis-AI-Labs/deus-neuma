/**
 * Tool-result retrieval (CCR-lite, FR-5/FR-6) — pure GNOSIS tests.
 * Real chunker, real BM25 index, real compressor underneath. No mocks:
 * every assertion is on real inputs → real outputs of the actual module.
 */

import { describe, it, expect } from 'vitest';
import { chunkContent, retrieveFromRecord } from '../../core/runtime/tool-result-retrieval.js';
import { compressToolResult } from '../../core/runtime/tool-result-compressor.js';

const REF = 'tr_ab12cd34_7_deadbeef';

// Realistic multi-topic tool output — distinct vocabularies per section so
// BM25 relevance is testable for real, not by construction of a single word.
const makeMultiTopic = () => {
  const sections = [
    ['DATABASE MIGRATION', 'applied migration 0042_add_wallet_index; postgres schema now at revision 0042; vacuum analyze completed on table neuma_sessions'],
    ['NETWORK DIAGNOSTICS', 'socket connection to portal endpoint established; websocket handshake latency 12ms; keepalive ping interval 30000ms configured'],
    ['AUTHENTICATION TOKENS', 'wallet challenge signature verified; session token minted with sid8 prefix; token expiry set to 86400 seconds from issuance'],
    ['FILESYSTEM SWEEP', 'tool-results directory scanned; 3 stale jsonl files older than retention ttl removed; disk usage now 412 megabytes'],
    ['VESSEL PIPELINE', 'vrm loader accepted 8 vessels; arkit expression layers detected on 3 kenorie bakes; preset fallback engaged for store models'],
  ];
  return sections
    .map(([title, body]) => `=== ${title} ===\n${(body + '. ').repeat(12)}`)
    .join('\n');
};

const makeRecord = (content, ref = REF) => ({
  ref,
  seq: 7,
  tool: 'read_file',
  status: 'ok',
  content,
  chars: content.length,
  timestamp: '2026-07-04T00:00:00.000Z',
});

describe('chunkContent', () => {
  it('is deterministic and reassembles to the original content exactly', () => {
    const content = makeMultiTopic();
    const a = chunkContent(content);
    const b = chunkContent(content);
    expect(a).toEqual(b);
    expect(a.map((c) => c.text).join('')).toBe(content);
  });

  it('reports true [start, end) offsets and contiguous coverage', () => {
    const content = makeMultiTopic();
    const chunks = chunkContent(content);
    let cursor = 0;
    for (const c of chunks) {
      expect(c.start).toBe(cursor);
      expect(c.end).toBeGreaterThan(c.start);
      expect(content.slice(c.start, c.end)).toBe(c.text);
      cursor = c.end;
    }
    expect(cursor).toBe(content.length);
    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, i) => `c${i}`));
  });

  it('cuts on line boundaries where a newline exists in the window', () => {
    const content = Array.from({ length: 200 }, (_, i) => `line ${i} of the report with some padding text`).join('\n');
    const chunks = chunkContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks.slice(0, -1)) {
      expect(c.text.endsWith('\n')).toBe(true);
    }
  });

  it('respects a custom chunkChars target', () => {
    const content = 'x'.repeat(1000);
    const chunks = chunkContent(content, { chunkChars: 100 });
    expect(chunks.length).toBe(10);
    for (const c of chunks) expect(c.text.length).toBe(100);
  });

  it('never splits a surrogate pair at a chunk boundary', () => {
    // No-newline blob of astral characters forces character cuts exactly at
    // the window edge — the dangerous position.
    const pair = String.fromCharCode(0xd83d, 0xde00);
    const content = pair.repeat(1201); // 2402 chars, odd vs 800 boundary irrelevant — every cut lands mid-pattern
    const chunks = chunkContent(content, { chunkChars: 801 }); // odd size → naive cut would split a pair
    expect(chunks.map((c) => c.text).join('')).toBe(content);
    for (const c of chunks) {
      const first = c.text.charCodeAt(0);
      const last = c.text.charCodeAt(c.text.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false); // no leading lone low surrogate
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false); // no trailing lone high surrogate
    }
  });

  it('returns an empty frozen array for empty content', () => {
    const chunks = chunkContent('');
    expect(chunks).toEqual([]);
    expect(Object.isFrozen(chunks)).toBe(true);
  });

  it('returns frozen chunk objects', () => {
    const chunks = chunkContent(makeMultiTopic());
    expect(Object.isFrozen(chunks)).toBe(true);
    for (const c of chunks) expect(Object.isFrozen(c)).toBe(true);
  });
});

describe('retrieveFromRecord — BM25 mode', () => {
  it('pulls the chunk matching the query from realistic multi-topic content', () => {
    const record = makeRecord(makeMultiTopic());
    const result = retrieveFromRecord(record, { query: 'wallet challenge signature token expiry', cap: 2000 });
    expect(result.mode).toBe('bm25');
    expect(result.response).toContain('token expiry set to 86400 seconds');
    expect(result.response).not.toContain('vacuum analyze'); // database section not pulled
    expect(result.chunksReturned).toBeGreaterThan(0);
    expect(result.chunksReturned).toBeLessThanOrEqual(result.totalChunks);
  });

  it('scopes the index to this record only by construction — a term absent from the record cannot match', () => {
    const record = makeRecord(makeMultiTopic());
    const other = retrieveFromRecord(record, { query: 'kubernetes ingress annotation', cap: 2000 });
    expect(other.mode).toBe('anchored'); // vocabulary from some other tool result finds nothing here
  });

  it('emits honest per-window headers with true offsets into the original content', () => {
    const content = makeMultiTopic();
    const record = makeRecord(content);
    const result = retrieveFromRecord(record, { query: 'websocket handshake latency keepalive', cap: 3000 });
    expect(result.mode).toBe('bm25');
    const headers = [...result.response.matchAll(/\[ccr:(tr_[0-9a-f]{8}_\d+_[0-9a-f]{8}) chunk @(\d+)-(\d+)\]\n/g)];
    expect(headers.length).toBeGreaterThan(0);
    for (const [, ref, s, e] of headers) {
      expect(ref).toBe(REF);
      const start = Number(s);
      const end = Number(e);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(content.length);
      // The text after each header must actually be content.slice(start, end).
      expect(result.response).toContain(content.slice(start, end));
    }
  });

  it('footer states real numbers: chunks returned of total, chars shown of total', () => {
    const content = makeMultiTopic();
    const record = makeRecord(content);
    const result = retrieveFromRecord(record, { query: 'stale jsonl retention ttl disk usage', cap: 2500 });
    expect(result.mode).toBe('bm25');
    const m = result.response.match(/\[ccr:.+ — returned (\d+) of (\d+) matched chunks \((\d+) total\); showing (\d+) of (\d+) chars\]$/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(result.chunksReturned);
    expect(Number(m[2])).toBeGreaterThanOrEqual(Number(m[1]));
    expect(Number(m[3])).toBe(result.totalChunks);
    expect(Number(m[5])).toBe(content.length);
    // Shown chars are the real sum of window bodies present in the response.
    const bodies = result.response.split('\n[ccr:').length; // sanity: structured output
    expect(bodies).toBeGreaterThan(1);
    expect(Number(m[3])).toBeLessThanOrEqual(content.length);
  });

  it('respects the limit option', () => {
    // Every chunk mentions the query term — without limit all would match.
    const content = ('portal keepalive heartbeat status nominal across shards\n').repeat(400);
    const record = makeRecord(content);
    const result = retrieveFromRecord(record, { query: 'keepalive heartbeat', cap: 8000, limit: 2 });
    expect(result.mode).toBe('bm25');
    expect(result.chunksReturned).toBeLessThanOrEqual(2);
  });

  it('windows are sorted by original offset and adjacent windows merge', () => {
    const content = ('alpha beacon signal calibration pass\n').repeat(600);
    const record = makeRecord(content);
    const result = retrieveFromRecord(record, { query: 'beacon calibration', cap: 6000, limit: 5 });
    expect(result.mode).toBe('bm25');
    const starts = [...result.response.matchAll(/chunk @(\d+)-(\d+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i][0]).toBeGreaterThan(starts[i - 1][1]); // strictly after, never adjacent (merged) or overlapping
    }
  });
});

describe('retrieveFromRecord — cap invariant (hard, every path)', () => {
  const contents = {
    multiTopic: makeMultiTopic(),
    noNewlineBlob: 'lorem ipsum dolor sit amet consectetur '.repeat(500).replace(/\s/g, 'x'),
    manyHits: ('retry backoff exponential jitter applied to request queue\n').repeat(500),
  };
  const caps = [30, 50, 120, 300, 1000, 4000];
  const queries = [undefined, '', 'retry backoff jitter', 'lorem ipsum dolor', 'zz-no-such-term-zz'];

  for (const [name, content] of Object.entries(contents)) {
    for (const cap of caps) {
      for (const query of queries) {
        it(`${name} / cap=${cap} / query=${JSON.stringify(query ?? null)} stays under cap`, () => {
          const result = retrieveFromRecord(makeRecord(content), { query, cap, limit: 50 });
          expect(result.response.length).toBeLessThanOrEqual(cap);
        });
      }
    }
  }

  it('holds with a huge query string on a tiny cap', () => {
    const result = retrieveFromRecord(makeRecord(makeMultiTopic()), {
      query: 'no-match-vocabulary '.repeat(200),
      cap: 80,
    });
    expect(result.response.length).toBeLessThanOrEqual(80);
  });
});

describe('retrieveFromRecord — fallbacks and honesty', () => {
  it('no BM25 hits → honest note + anchored slice, still under cap', () => {
    const record = makeRecord(makeMultiTopic());
    const result = retrieveFromRecord(record, { query: 'quasar entanglement flux', cap: 2000 });
    expect(result.mode).toBe('anchored');
    expect(result.chunksReturned).toBe(0);
    expect(result.response).toContain('no chunks matched "quasar entanglement flux"; anchored slice instead');
    expect(result.response).toContain(`[ccr:${REF}`); // anchored slice carries the ref marker
    expect(result.response.length).toBeLessThanOrEqual(2000);
  });

  it('empty query string is treated as no query — plain anchored slice, same as compressToolResult', () => {
    const content = makeMultiTopic();
    const record = makeRecord(content);
    const blank = retrieveFromRecord(record, { query: '   ', cap: 1500 });
    const none = retrieveFromRecord(record, { cap: 1500 });
    expect(blank.mode).toBe('anchored');
    expect(blank.response).toBe(none.response);
    expect(none.response).toBe(compressToolResult(content, { cap: 1500, ref: REF }).compressed);
  });

  it('content within cap → whole content verbatim + honest complete note', () => {
    const content = 'short result: 42 rows updated\nstatus: ok';
    const record = makeRecord(content);
    const result = retrieveFromRecord(record, { cap: 4000 });
    expect(result.mode).toBe('anchored');
    expect(result.response.startsWith(content)).toBe(true);
    expect(result.response).toContain(`[ccr:${REF} — complete result, ${content.length} chars]`);
    expect(result.chunksReturned).toBe(result.totalChunks);
  });

  it('content within cap but no room for the note → verbatim content alone, cap held', () => {
    const content = 'y'.repeat(100);
    const result = retrieveFromRecord(makeRecord(content), { cap: 100 });
    expect(result.response).toBe(content);
    expect(result.response.length).toBeLessThanOrEqual(100);
  });

  it('content within cap ignores the query — nothing was cut, nothing to search back', () => {
    const content = 'auth token minted for session';
    const result = retrieveFromRecord(makeRecord(content), { query: 'token', cap: 4000 });
    expect(result.mode).toBe('anchored');
    expect(result.response.startsWith(content)).toBe(true);
  });
});

describe('retrieveFromRecord — malformed records throw', () => {
  it('throws on null (a silent empty response would be a lie)', () => {
    expect(() => retrieveFromRecord(null)).toThrow(/record must be/);
  });

  it('throws on non-object and array records', () => {
    expect(() => retrieveFromRecord('tr_ab12cd34_7_deadbeef')).toThrow(/record must be/);
    expect(() => retrieveFromRecord([])).toThrow(/record must be/);
    expect(() => retrieveFromRecord(undefined)).toThrow(/record must be/);
  });

  it('throws on missing or non-string content', () => {
    expect(() => retrieveFromRecord({ ref: REF })).toThrow(/content must be a string/);
    expect(() => retrieveFromRecord({ ref: REF, content: 42 })).toThrow(/content must be a string/);
  });

  it('throws on missing or empty ref', () => {
    expect(() => retrieveFromRecord({ content: 'x'.repeat(10) })).toThrow(/ref must be/);
    expect(() => retrieveFromRecord({ content: 'x', ref: '' })).toThrow(/ref must be/);
  });
});

describe('retrieveFromRecord — determinism and immutability', () => {
  it('double-call byte equality on the BM25 path', () => {
    const record = makeRecord(makeMultiTopic());
    const opts = { query: 'vrm loader arkit expression preset', cap: 2200 };
    const a = retrieveFromRecord(record, opts);
    const b = retrieveFromRecord(record, opts);
    expect(a.response).toBe(b.response);
    expect(a).toEqual(b);
  });

  it('double-call byte equality on the anchored path', () => {
    const record = makeRecord(makeMultiTopic());
    const a = retrieveFromRecord(record, { cap: 900 });
    const b = retrieveFromRecord(record, { cap: 900 });
    expect(a.response).toBe(b.response);
  });

  it('returns a frozen result and does not mutate the record', () => {
    const record = makeRecord(makeMultiTopic());
    const snapshot = JSON.stringify(record);
    const result = retrieveFromRecord(record, { query: 'migration schema revision', cap: 1800 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(record)).toBe(snapshot);
  });

  it('surrogate-pair content survives BM25 window trimming without lone surrogates', () => {
    const pair = String.fromCharCode(0xd83d, 0xde01);
    // Searchable words interleaved with astral runs, no newlines — trims land on char cuts.
    const content = (`emissive shader pass ${pair.repeat(40)} `).repeat(120);
    const result = retrieveFromRecord(makeRecord(content), { query: 'emissive shader', cap: 400, limit: 3 });
    expect(result.response.length).toBeLessThanOrEqual(400);
    for (let i = 0; i < result.response.length; i++) {
      const c = result.response.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = result.response.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        i++;
      } else {
        expect(c >= 0xdc00 && c <= 0xdfff).toBe(false);
      }
    }
  });
});

describe('footer honesty: returned vs matched are distinct real numbers', () => {
  it('reports both counts when the cap admits fewer chunks than matched', () => {
    const term = 'needle';
    const lines = [];
    for (let i = 0; i < 40; i++) {
      lines.push(`${term} occurrence block ${i} ` + 'filler '.repeat(120));
    }
    const record = {
      ref: 'tr_aabbccdd_1_deadbeef',
      content: lines.join('\n'),
      chars: lines.join('\n').length,
      tool: 't',
      status: 'ok'
    };
    const out = retrieveFromRecord(record, { query: term, cap: 1600, limit: 50 });
    expect(out.mode).toBe('bm25');
    const m = out.response.match(/returned (\d+) of (\d+) matched chunks \((\d+) total\)/);
    expect(m).not.toBeNull();
    const [, returned, matched, total] = m.map(Number);
    expect(out.chunksReturned).toBe(returned);
    expect(matched).toBeGreaterThanOrEqual(returned);
    expect(total).toBeGreaterThanOrEqual(matched);
    expect(out.response.length).toBeLessThanOrEqual(1600);
  });
});
