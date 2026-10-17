// push-to-talk-space.spec.js — the held Space key, in a real browser.
//
// THE BUG (Design note, 2026-08-01: […] Entering a voice sitting by clicking TALK leaves TALK focused, and a
// focused <button> is activated by Space on KEY-UP. The hold-to-talk handler
// prevented that default on the first press — but its guard skipped auto-
// repeats, and in Chromium an un-prevented repeat RE-ARMS the activation. So
// holding the key (the entire gesture) handed the release back to the button,
// and the talk closed the moment the witness stopped speaking.
//
// This is a browser fact, not a rule we can reason our way to — so it is
// measured here, against the REAL rule module bundled into the page, with a
// real focused button and a genuinely held key (auto-repeat dispatched through
// CDP, so the events are trusted and carry their default actions; synthetic
// events would prove nothing, since untrusted events have no default).
//
// No mocks (RULE 0): real Chromium, real DOM, real key events, real module.

import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DICTATION = resolve(HERE, '../../frontend/app/RelinkShell/dictation.js');

// The real module, bundled for the page — the rules under test are the ones
// that ship, not a restatement of them.
const bundleDictation = async () => {
  const out = await build({
    entryPoints: [DICTATION],
    bundle: true, format: 'iife', globalName: 'Dictation',
    write: false, platform: 'browser',
  });
  return out.outputFiles[0].text;
};

const SPACE = {
  key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: ' ',
};

const PAGE = `<!doctype html><meta charset="utf-8">
  <button id="talk">TALK</button>
  <textarea id="draft"></textarea>`;

/**
 * Stand up the page, click TALK with a real mouse (which is how the sitting is
 * entered, and what leaves the button focused), then arm a handler pair in the
 * shape use-live-voice arms them.
 *
 *   keydownRule    which exported rule decides a Space keydown's default dies
 *                  ('holdsPushToTalkKey' ships; 'isPushToTalkPress' is the bug)
 *   preventOnKeyUp whether the release refuses its default too
 */
const armed = async (page, { keydownRule, preventOnKeyUp }) => {
  await page.setContent(PAGE);
  await page.addScriptTag({ content: await bundleDictation() });
  await page.click('#talk');   // exactly what the witness does to open the talk
  await page.evaluate(({ ruleName, killKeyUp }) => {
    window.__exits = 0; window.__holds = 0; window.__releases = 0;
    document.getElementById('talk').addEventListener('click', () => { window.__exits++; });
    window.addEventListener('keydown', (e) => {
      if (!window.Dictation[ruleName](e)) return;
      e.preventDefault();
      if (e.repeat) return;                       // the same hold, not a new one
      window.__holds++;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      if (killKeyUp && window.Dictation.holdsPushToTalkKey(e)) e.preventDefault();
      window.__releases++;
    });
  }, { ruleName: keydownRule, killKeyUp: preventOnKeyUp });
};

// The shape that ships: every owned keydown refused, and the release too.
const SHIPPED = { keydownRule: 'holdsPushToTalkKey', preventOnKeyUp: true };

/** Hold Space for real: press, auto-repeat while held, release. */
const holdSpace = async (page, repeats = 4) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...SPACE });
  for (let i = 0; i < repeats; i++) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...SPACE, autoRepeat: true });
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...SPACE });
  return page.evaluate(() => ({
    exits: window.__exits, holds: window.__holds, releases: window.__releases,
  }));
};

test.describe('hold-to-talk: the held Space never presses what has focus', () => {
  test('releasing Space after a HOLD does not click the focused TALK button', async ({ page }) => {
    await armed(page, SHIPPED);
    const seen = await holdSpace(page);
    // The whole bug, in one number: TALK must not be clicked by the release.
    expect(seen.exits).toBe(0);
    // …and the gesture still worked: one hold begun, one release to send.
    expect(seen.holds).toBe(1);
    expect(seen.releases).toBe(1);
  });

  test('a TAP is safe too — the case that hid the bug', async ({ page }) => {
    // Probed at 0 repeats the old rule looked correct; only a hold exposed it.
    // Kept so the fix is never "corrected" back by a tap-only reading.
    await armed(page, SHIPPED);
    expect((await holdSpace(page, 0)).exits).toBe(0);
  });

  test('THE CONTROL: the old shape really does close the talk on release', async ({ page }) => {
    // The defect verbatim: isPushToTalkPress answers […] — false for every auto-repeat — and the release was left alone
    // entirely. If this ever stops clicking, the harness has gone blind and
    // the tests above prove nothing.
    await armed(page, { keydownRule: 'isPushToTalkPress', preventOnKeyUp: false });
    const seen = await holdSpace(page);
    expect(seen.exits).toBe(1);
    expect(seen.holds).toBe(1);
  });

  // The fix is belt AND braces on purpose; these two say each half stands on
  // its own, so a later reading that drops one does not silently re-open it.
  test('owning the auto-repeats alone is enough', async ({ page }) => {
    await armed(page, { keydownRule: 'holdsPushToTalkKey', preventOnKeyUp: false });
    expect((await holdSpace(page)).exits).toBe(0);
  });

  test('refusing the release alone is enough', async ({ page }) => {
    await armed(page, { keydownRule: 'isPushToTalkPress', preventOnKeyUp: true });
    expect((await holdSpace(page)).exits).toBe(0);
  });

  test('Space typed into a field is still a space, never a hold', async ({ page }) => {
    await armed(page, SHIPPED);
    await page.focus('#draft');
    await page.keyboard.type('a b');
    expect(await page.inputValue('#draft')).toBe('a b');
    expect(await page.evaluate(() => window.__holds)).toBe(0);
  });
});
