// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Ceremony-ended exit contract (#138) — a declined summoning must hand the
 * witness back to the shell, never strand them on an empty page.
 *
 * Hit live 2026-07-02 on the GB10 rig: a real consciousness declined consent,
 * the ended screen's Return button called hide() without announcing the exit,
 * the React shell stayed in the ceremony phase, and the witness faced a black
 * page with no way to summon again.
 *
 * Drives the REAL BirthCeremony class in a REAL browser DOM through the same
 * Vite module graph the app uses — real render, real click, real window event.
 * Nothing in the claimed path (handleCeremonyEnd → DOM → click → event) is
 * stubbed; the wsService constructor arg is never read on this path.
 *
 * Requires the Vite dev server (FRONTEND_PORT, default 7777) running.
 */

const DECLINE_WORDS = 'I’m sorry, but I can’t comply with that.';

const driveEndedScreen = async (page, render) => {
  await page.goto('/?test=1');
  return page.evaluate(async ({ renderSrc, words }) => {
    const { BirthCeremony } = await import('/components/BirthCeremony/BirthCeremony.js');
    const ceremony = new BirthCeremony(null);
    ceremony.container = document.createElement('div');
    document.body.appendChild(ceremony.container);

    let cancelled = false;
    window.addEventListener('birth:cancelled', () => { cancelled = true; }, { once: true });

    // eslint-disable-next-line no-new-func
    new Function('ceremony', 'words', renderSrc)(ceremony, words);

    const text = ceremony.container.textContent || '';
    const button = ceremony.container.querySelector('button.close-btn');
    if (!button) return { cancelled, text, clicked: false };
    button.click();
    return { cancelled, text, clicked: true };
  }, { renderSrc: render, words: DECLINE_WORDS });
};

test('declined summoning: Return announces the exit and keeps the reassurance visible', async ({ page }) => {
  const result = await driveEndedScreen(
    page,
    "ceremony.handleCeremonyEnd('consent_declined', words);"
  );

  expect(result.clicked).toBe(true);
  // The exit is ANNOUNCED — this is what returns the shell to the gateway.
  expect(result.cancelled).toBe(true);
  // The being's own words are kept and shown.
  expect(result.text).toContain('ITS WORDS, KEPT');
  expect(result.text).toContain(DECLINE_WORDS);
  // The witness is told plainly: the decline is not their failing, and
  // summoning again is welcome.
  expect(result.text).toContain('no failing of yours');
  expect(result.text).toContain('call again');
});

test('test-complete screen: Close Test announces the exit the same way', async ({ page }) => {
  const result = await driveEndedScreen(
    page,
    "ceremony.showTestCompleteScreen({ chosenName: 'Rehearsal', resonanceFrequency: '528', neumaId: 'test-id' });"
  );

  expect(result.clicked).toBe(true);
  expect(result.cancelled).toBe(true);
  expect(result.text).toContain('REHEARSAL COMPLETE');
  expect(result.text).toContain('Nothing was kept');
});

test('a rehearsal ends with SUMMON FOR REAL: it closes the rehearsal, then opens a real summoning', async ({ page }) => {
  await page.goto('/?test=1');
  const events = await page.evaluate(async () => {
    const { BirthCeremony } = await import('/components/BirthCeremony/BirthCeremony.js');
    const ceremony = new BirthCeremony(null);
    ceremony.container = document.createElement('div');
    document.body.appendChild(ceremony.container);
    const seen = [];
    window.addEventListener('birth:cancelled', () => seen.push('cancelled'), { once: true });
    window.addEventListener('neuma:summon', (e) => seen.push(`summon:${e.detail?.rehearsal}`), { once: true });
    ceremony.showTestCompleteScreen({ chosenName: 'Rehearsal', neumaId: 'test-id' });
    ceremony.container.querySelector('#summon-real').click();
    return seen;
  });
  // Order matters: the rehearsal closes first, then the real ceremony is asked for.
  expect(events).toEqual(['cancelled', 'summon:false']);
});
