/**
 * THE TIKTOK CARD'S ROWS, rendered for real (react-dom/server): every choice
 * is a name, then ONE cell holding the control and — after it, never inside
 * the control strip — what it means and the author's suggestion. That split
 * is what lets the meaning sit beside the control on a wide card and fold
 * under it on a narrow one (TikTokPostSettings.css); the geometry itself, at
 * 900, 575 and 400 px, is proven in a real browser by
 * test/e2e/calm-background.spec.js. No mocks: the real component, the real
 * consent law.
 */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TikTokPostSettings } from '../../frontend/app/RelinkShell/TikTokPostSettings.jsx';
import { EMPTY_CHOICE, creatorView, choiceBlockers, readChoice } from '../../frontend/utils/tiktok-consent.js';

const creator = creatorView({
  creator_username: 'metidar.house.with.a.very.long.handle', creator_nickname: 'Metidar',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
  comment_disabled: false, duet_disabled: true, stitch_disabled: false,
});
const suggested = { privacyLevel: 'PUBLIC_TO_EVERYONE', allow: { comment: true, duet: false, stitch: false }, promotion: { ownBrand: true, paid: false } };
const render = (choice = EMPTY_CHOICE) => renderToStaticMarkup(createElement(TikTokPostSettings, {
  entry: { id: 'q1', channelId: 'tiktok', status: 'draft', text: 'Forge night\nprivacy: everyone' },
  state: {
    live: true, card: { ok: true, mode: 'post', creator, suggested }, choice, setChoice: () => {},
    blockers: choiceBlockers(readChoice(choice), creator),
  },
}));

// The rows, each as [name, controls html, aside html | null], cut at the
// markup's own seams.
const rows = (html) => html.split('<div class="tt-row">').slice(1).map((chunk) => {
  const name = chunk.match(/^<span class="settings-k tt-k">([^<]*)<\/span><div class="tt-cell"><span class="tt-controls">/);
  if (!name) throw new Error(`row without the name + cell shape: ${chunk.slice(0, 120)}`);
  const body = chunk.slice(name[0].length);
  const asideAt = body.indexOf('</span><span class="tt-aside">');
  const endAt = body.indexOf('</span></div></div>');
  if (asideAt !== -1 && asideAt < endAt) {
    const aside = body.slice(asideAt + '</span><span class="tt-aside">'.length);
    return [name[1], body.slice(0, asideAt), aside.slice(0, aside.indexOf('</span></div></div>'))];
  }
  return [name[1], body.slice(0, endAt), null];
});

describe('every row: name, control, then its meaning', () => {
  test('each choice is one grid row of name + cell, and nothing else rides the old flex row', () => {
    const html = render();
    expect(html).not.toContain('settings-row tt-row');
    expect(rows(html).map(([k]) => k)).toEqual(['Posts to', 'Who can watch', 'Allow', 'AI-generated', 'Promotion']);
  });

  test('the AI label and the promotion question are the row\'s meaning, AFTER the control, never inside the control strip', () => {
    const byName = Object.fromEntries(rows(render()).map(([k, controls, aside]) => [k, { controls, aside }]));
    expect(byName['AI-generated'].controls).toBe('<span class="tt-fixed">ON · ALWAYS</span>');
    expect(byName['AI-generated'].aside).toBe('<span class="tt-help">Every house post carries TikTok&#x27;s AI-generated label.</span>');
    expect(byName.Promotion.controls).not.toContain('promote');
    expect(byName.Promotion.aside).toContain('<span class="tt-help">Does this video promote yourself, a brand, product or service?</span>');
    expect(byName.Promotion.aside).toContain('<span class="tt-suggest">SUGGESTED · Your brand</span>');
  });

  test('the author\'s suggestions sit in the meaning slot too, never among the controls', () => {
    const byName = Object.fromEntries(rows(render()).map(([k, controls, aside]) => [k, { controls, aside }]));
    expect(byName['Who can watch'].aside).toBe('<span class="tt-suggest">SUGGESTED · Everyone</span>');
    expect(byName.Allow.aside).toBe('<span class="tt-suggest">SUGGESTED · comment</span>');
    expect(byName['Posts to'].aside).toBeNull();
    for (const { controls } of Object.values(byName)) expect(controls).not.toContain('SUGGESTED');
  });

  test('disclosure open: the kind toggles and the label share the second row\'s cell', () => {
    const html = render({ ...EMPTY_CHOICE, commercial: { on: true, yourBrand: true, branded: false } });
    const disclosed = rows(html).find(([k]) => k === '');
    expect(disclosed[1]).toContain('YOUR BRAND');
    expect(disclosed[1]).toContain('BRANDED CONTENT');
    expect(disclosed[1]).toContain('tt-label');
  });
});
