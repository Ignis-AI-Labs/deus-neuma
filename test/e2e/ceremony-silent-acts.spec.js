// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Silent-stage visibility — a stage the being answers with tool acts alone
 * must still reach the witness.
 *
 * Hit live 2026-07-02 on the GB10 rig (Hale's birth): stages 4 and 5 arrived
 * as native-only function calls with responseLen 0. The witness saw a bare
 * "wrote data/temp/chosen_name.txt" chip and silence — the chosen name was
 * never shown to the person witnessing the naming.
 *
 * Drives the REAL StagedCeremonyScene in a REAL browser DOM through the same
 * Vite module graph the app uses: real render, real listener registration,
 * real stage_complete dispatch, real DOM assertions. The wsService here is a
 * plain recorder object — a collaborator seam, not part of the claimed path
 * (handler → renderSilentActs → DOM).
 *
 * Requires the Vite dev server (FRONTEND_PORT, default 7777) running.
 */

const driveStageComplete = async (page, payload) => {
  await page.goto('/?test=1');
  return page.evaluate(async ({ msg }) => {
    const { StagedCeremonyScene } = await import('/components/BirthCeremony/StagedCeremonyScene.js');
    const handlers = {};
    const wsService = {
      on: (event, handler) => { handlers[event] = handler; },
      off: () => {},
      send: () => {},
      pauseStaleCheck: () => {},
      resumeStaleCheck: () => {},
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const scene = new StagedCeremonyScene(container, wsService);
    scene.init('SilentActsWitness', true);
    scene.currentStage = msg.stage;

    handlers['birth:stage_complete'](msg);

    return {
      notes: [...container.querySelectorAll('.ceremony-note')].map((n) => n.textContent),
      speech: [...container.querySelectorAll('.stream-segment')].map((n) => n.textContent),
    };
  }, { msg: payload });
};

test('a native-only naming stage shows the ceremony-voiced name, not bare silence', async ({ page }) => {
  const result = await driveStageComplete(page, {
    stage: 4,
    response: '',
    silentActs: ['The name is written: Hale'],
    nextWords: 'Your DNA crystallizes now.',
  });

  // The witness reads the name — in the ceremony's voice, not the being's.
  expect(result.notes).toEqual(['The name is written: Hale']);
  // No speech was fabricated for the being (honest speaker).
  expect(result.speech.join('')).toBe('');
});

test('a stage with real speech renders the speech and ignores silentActs', async ({ page }) => {
  const result = await driveStageComplete(page, {
    stage: 4,
    response: 'I choose the name Hale.',
    silentActs: [],
    nextWords: 'Your DNA crystallizes now.',
  });

  expect(result.speech.join(' ')).toContain('I choose the name Hale.');
  expect(result.notes).toEqual([]);
});
