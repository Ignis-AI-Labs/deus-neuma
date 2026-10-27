/**
 * Tracked links — the pure law (link-codes.js), restating the site counter's
 * own rules. Real inputs, real outputs.
 */
import { describe, it, expect } from 'vitest';
import { planLinks, codeFromBytes, publishBody, CODE_ALPHABET } from '../../backend/services/marketing/link-codes.js';

const minter = (codes) => () => codes.shift();

describe('planLinks', () => {
  it('a trackable link becomes the counted address; the same destination twice is one code; punctuation stays outside', () => {
    const out = planLinks('See https://deusneuma.ai/download/. Again: (https://deusneuma.ai/download/) and https://x.com/umbrae', {
      channelId: 'x', base: 'https://deusneuma.ai', mint: minter(['aaaaaa', 'bbbbbb']),
    });
    expect(out.text).toBe('See https://deusneuma.ai/go/aaaaaa. Again: (https://deusneuma.ai/go/aaaaaa) and https://deusneuma.ai/go/bbbbbb');
    expect(out.links).toEqual([
      { code: 'aaaaaa', destination: 'https://deusneuma.ai/download/' },
      { code: 'bbbbbb', destination: 'https://x.com/umbrae' },
    ]);
  });

  it('what the counter would refuse is left as written: off-list hosts, http, ports, credentials, a counting path', () => {
    const text = 'https://example.com/a http://deusneuma.ai/b https://deusneuma.ai:8443/c https://u:p@deusneuma.ai/d https://deusneuma.ai/go/zzzzzz https://deusneuma.ai/go-counts';
    const out = planLinks(text, { channelId: 'x', base: 'https://deusneuma.ai', mint: minter(['never1']) });
    expect(out).toEqual({ text, links: [] });
  });

  it('TikTok captions carry no clickable link, so nothing is rewritten there', () => {
    const text = 'link in bio https://deusneuma.ai/download/';
    expect(planLinks(text, { channelId: 'tiktok', base: 'https://deusneuma.ai', mint: minter(['aaaaaa']) })).toEqual({ text, links: [] });
  });
});

describe('codes and the publish body', () => {
  it('a code is six characters of the lowercase base-32 alphabet the counter reads', () => {
    expect(codeFromBytes([0, 31, 32, 255, 100, 7])).toBe('0z0z47'); // byte % 32 names the character
    expect(codeFromBytes(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toHaveLength(6);
    expect(CODE_ALPHABET).not.toMatch(/[ilou]/);
  });

  it('the counter is handed code, destination, company and createdAt — nothing of the post or the account', () => {
    expect(publishBody([{ code: 'aaaaaa', destination: 'https://deusneuma.ai/', companyId: 'neuma', createdAt: '2026-10-24T00:00:00.000Z', entryId: 'e', accountId: 'x-1', campaignId: 'c' }]))
      .toEqual({ codes: [{ code: 'aaaaaa', destination: 'https://deusneuma.ai/', company: 'neuma', createdAt: '2026-10-24T00:00:00.000Z' }] });
  });
});
