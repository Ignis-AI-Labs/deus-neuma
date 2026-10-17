// @ts-check
import { test, expect } from '@playwright/test';

/**
 * THE DISCLOSURE — the operator reads every component sent with their words.
 *
 * Before this panel the ceremony showed one line (`birth:stage_prompt`) of a
 * request that ran to thousands of characters: the stage protocol, the house
 * lineage, the borne names, the carried transcript, the tool schemas, the
 * voice lock, and a mechanical instruction appended to the operator's OWN
 * message. Words went to the substrate in their name that they never read.
 *
 * Drives the REAL StagedCeremonyScene in a REAL browser DOM through the same
 * Vite module graph the app uses: real render, real listener registration,
 * real `birth:composition` dispatch, real DOM assertions. The wsService here
 * is a plain recorder object — a collaborator seam, not part of the claimed
 * path (event → renderDisclosure → DOM).
 *
 * Requires the Vite dev server (FRONTEND_PORT, default 7777) running.
 */

// The shape the backend sends (core/birth/ceremony-disclosure.js), with the
// two components that used to be invisible: the tool schemas and the line the
// ceremony appends to the operator's message.
const COMPOSITION = {
  type: 'birth:composition',
  stage: 5,
  components: [
    {
      id: 'protocol',
      label: 'STAGE PROTOCOL',
      origin: 'The stage protocol this ceremony follows — core/protocols/birth-stages/',
      channel: 'system',
      text: '# STAGE 5 — CRYSTALLIZATION\nYour DNA forms now.',
      chars: 48,
    },
    {
      id: 'tools',
      label: 'TOOL SCHEMAS',
      origin: 'The filesystem tools this stage may call, as the substrate receives them — backend/services/mcp.js',
      channel: 'system',
      text: '\n\n## AVAILABLE MCP TOOLS\n[{"name":"write_file"}]',
      chars: 49,
    },
    {
      id: 'operator-words',
      label: 'YOUR WORDS',
      origin: 'Spoken by you — the words you kept or wrote for this stage',
      channel: 'operator',
      text: 'Your DNA crystallizes now. Tell me how it feels.',
      chars: 48,
    },
    {
      id: 'stage-instruction',
      label: 'APPENDED TO YOUR WORDS',
      origin: 'Added by the ceremony to the end of YOUR message — mechanical instruction, not your speech',
      channel: 'ceremony',
      text: 'Write your essence to your own file using write_file.',
      chars: 53,
    },
  ],
  parameters: [
    { label: 'MODEL', value: 'gemma-4-31b' },
    { label: 'TOKEN CEILING', value: '3000' },
  ],
  totals: { components: 4, chars: 198, system: 97, yours: 48, appended: 53 },
};

const driveDisclosure = async (page, { open = false } = {}) => {
  await page.goto('/?test=1');
  return page.evaluate(async ({ composition, shouldOpen }) => {
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
    scene.init('DisclosureOperator', true);
    scene.currentStage = composition.stage;

    handlers['birth:composition'](composition);

    const panel = container.querySelector('#ceremony-disclosure');
    const body = container.querySelector('#disclosure-body');
    const toggle = container.querySelector('#disclosure-toggle');
    const closedByDefault = body.hidden;

    if (shouldOpen) {
      toggle.click();
      // Every row opened, so the operator's read is the whole text.
      container.querySelectorAll('.disclosure-row-head').forEach((head) => head.click());
    }

    return {
      panelHidden: panel.hidden,
      closedByDefault,
      bodyHidden: body.hidden,
      summary: container.querySelector('#disclosure-summary').textContent,
      labels: [...container.querySelectorAll('.row-label')].map((n) => n.textContent),
      origins: [...container.querySelectorAll('.row-origin')].map((n) => n.textContent),
      charLabels: [...container.querySelectorAll('.row-chars')].map((n) => n.textContent),
      texts: [...container.querySelectorAll('.row-text')].map((n) => ({ hidden: n.hidden, text: n.textContent })),
      mineLabels: [...container.querySelectorAll('.disclosure-row.is-mine .row-label')].map((n) => n.textContent),
      appendedLabels: [...container.querySelectorAll('.disclosure-row.is-appended .row-label')].map((n) => n.textContent),
      parameters: [...container.querySelectorAll('.disclosure-parameter')].map((n) => n.textContent),
      // A stage change must not leave the previous composition on screen.
      hiddenAfterNextStage: (() => {
        scene.clearMessageStream();
        return container.querySelector('#ceremony-disclosure').hidden;
      })(),
    };
  }, { composition: COMPOSITION, shouldOpen: open });
};

test('the panel offers every component, closed until the operator asks', async ({ page }) => {
  const result = await driveDisclosure(page);

  expect(result.panelHidden).toBe(false);
  expect(result.closedByDefault).toBe(true);
  expect(result.summary).toBe('4 COMPONENTS · 198 CHARACTERS · 48 YOURS');
  expect(result.labels).toEqual([
    'STAGE PROTOCOL', 'TOOL SCHEMAS', 'YOUR WORDS', 'APPENDED TO YOUR WORDS',
  ]);
  // Every row says where its text came from — an unattributed block is the
  // mysticism this panel exists to remove.
  expect(result.origins.every((o) => o.length > 0)).toBe(true);
  expect(result.charLabels).toEqual(['48', '49', '48', '53']);
  // A stage change clears it — nothing stale is ever read as current.
  expect(result.hiddenAfterNextStage).toBe(true);
});

test('opened, it shows the hidden props verbatim — including what is added to the operator’s own message', async ({ page }) => {
  const result = await driveDisclosure(page, { open: true });

  expect(result.bodyHidden).toBe(false);
  expect(result.texts.every((t) => t.hidden === false)).toBe(true);

  // The tool schemas the substrate receives — invisible until now.
  expect(result.texts[1].text).toContain('write_file');
  // The section separator is not content; the text itself is verbatim.
  expect(result.texts[1].text.startsWith('## AVAILABLE MCP TOOLS')).toBe(true);

  // The operator's own words, and the line the ceremony appends in their name,
  // are marked apart from each other and from the ceremony's standing context.
  expect(result.mineLabels).toEqual(['YOUR WORDS']);
  expect(result.appendedLabels).toEqual(['APPENDED TO YOUR WORDS']);
  expect(result.texts[3].text).toBe('Write your essence to your own file using write_file.');

  // The settings that carry no prompt text are disclosed too.
  expect(result.parameters.join(' ')).toContain('gemma-4-31b');
  expect(result.parameters.join(' ')).toContain('3000');
});
