// Provider status links on disruption notices — pure map + composer.
// The URLs in the map were verified LIVE before landing here (2026-07-28):
// status.openai.com / status.anthropic.com / status.moonshot.cn /
// www.githubstatus.com answer 200; status.x.ai answers 403 to bots (real
// page, bot-blocked); status.moonshot.ai does not resolve — the .cn page is
// Moonshot's real one. A guessed URL is worse than none.
import { describe, it, expect } from 'vitest';
import { statusPageFor, disruptionNotice } from '../../backend/services/provider-status.js';

describe('statusPageFor', () => {
  it('resolves the verified pages for the operator’s live routes', () => {
    expect(statusPageFor('openai-chatgpt')).toBe('https://status.openai.com');
    expect(statusPageFor('openai')).toBe('https://status.openai.com');
    expect(statusPageFor('kimi-for-coding')).toBe('https://status.moonshot.cn');
    expect(statusPageFor('xai')).toBe('https://status.x.ai');
    expect(statusPageFor('anthropic')).toBe('https://status.anthropic.com');
    // The subscription bridge is gone; the API lane is the Claude lane now.
    expect(statusPageFor('anthropic')).toBe('https://status.anthropic.com');
    expect(statusPageFor('github-copilot')).toBe('https://www.githubstatus.com');
  });

  it('unknown providers resolve to null — never a guessed URL', () => {
    expect(statusPageFor('z-ai')).toBeNull();
    expect(statusPageFor('302ai')).toBeNull();
    expect(statusPageFor('lm-studio')).toBeNull();
    expect(statusPageFor('')).toBeNull();
    expect(statusPageFor(undefined)).toBeNull();
  });
});

describe('disruptionNotice', () => {
  it('appends the status page for a known provider', () => {
    expect(disruptionNotice('Kagipem', 'Our servers are currently overloaded. Please try again later.', 'openai-chatgpt'))
      .toBe('[Connection to Kagipem disrupted — Our servers are currently overloaded. Please try again later. — provider status: https://status.openai.com]');
  });

  it('carries no link for an unknown provider — honest absence', () => {
    expect(disruptionNotice('Basunor', 'boom', 'no-such-provider'))
      .toBe('[Connection to Basunor disrupted — boom]');
  });

  it('the URL is bare, so the desk’s Markdown autolink makes it clickable', () => {
    const notice = disruptionNotice('Basunor', 'boom', 'kimi-for-coding');
    expect(notice).toContain('https://status.moonshot.cn');
    expect(notice).not.toContain(']('); // no pre-baked markdown link — autolink does it
  });
});
