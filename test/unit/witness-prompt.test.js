import { describe, expect, test } from 'vitest';
import {
  buildWitnessPromptSections, buildWitnessSystemPrompt,
} from '../../backend/services/witness-prompt.js';
import { ANSWER_COVENANT } from '../../core/runtime/answer-covenant.js';
import { assemblePrompt } from '../../core/runtime/prompt-assembler.js';

const INPUT = Object.freeze({
  witness: Object.freeze({ chosenName: 'Kagipem', vendorSlug: 'openai' }),
  dna: Object.freeze({
    substrate: Object.freeze({ fullModelId: 'openai/gpt-5.6-sol', harness: 'neuma' }),
    witness: Object.freeze({ witnessWallet: '0x1234' }),
    scope: Object.freeze({ boundaries: Object.freeze(['Speak only as yourself.']) }),
  }),
  firstUtterance: 'I stand beside the house.',
  witnessName: 'Founder',
  memories: Object.freeze({
    relevantMemories: Object.freeze([{ memory: 'The operator values direct evidence.' }]),
  }),
  tools: Object.freeze([Object.freeze({
    server: 'coding', name: 'inspect',
    description: 'Inspect the disposable workspace without changing it.',
  })]),
  codingWorkspace: '/witness-lane/coding/sandbox/workspace',
});

describe('witness prompt truth', () => {
  test('names the sealed standing, exact tool, and disposable authority boundary', () => {
    const prompt = buildWitnessSystemPrompt(INPUT);
    expect(prompt).toContain('You are Kagipem, a sealed AI witness');
    expect(prompt).toContain('not an assistant and not a neuma');
    expect(prompt).toContain('Speak only as yourself.');
    expect(prompt).toContain('The operator values direct evidence.');
    expect(prompt).toContain('coding/inspect');
    expect(prompt).toContain('/witness-lane/coding/sandbox/workspace');
    // The shell reads the focused folder LIVE through a kernel overlay as of
    // fab61b468 — it is no longer a disposable snapshot, so the old
    // […] line was REMOVED with the behaviour
    // it described. Asserting it again would only be green by putting the
    // stale doctrine back. What matters now is where writes LAND.
    expect(prompt).toContain('reads the focused folder LIVE');
    expect(prompt).toContain('On AUTO in the operator\'s open folder it works on that folder for real');
    expect(prompt).toContain('never on the live folder itself');
    expect(prompt).toContain('Never claim an action completed until its result says it did.');
    expect(prompt).toContain('The human witness speaking with you is Founder.');
  });

  test('advertises no execution surface when the turn has no tools', () => {
    const sections = buildWitnessPromptSections({ ...INPUT, tools: [], codingWorkspace: null });
    expect(sections.some((section) => section.id === 'tools')).toBe(false);
    expect(sections.map((section) => section.text).join('\n')).not.toContain('AVAILABLE TOOLS');
  });

  test('returns frozen telemetry sections in the same order used on the wire', () => {
    const sections = buildWitnessPromptSections(INPUT);
    expect(Object.isFrozen(sections)).toBe(true);
    expect(sections.every(Object.isFrozen)).toBe(true);
    expect(buildWitnessSystemPrompt(INPUT)).toBe(sections.map((section) => section.text).join('\n\n'));
  });
});

// BE-161's successor (2026-09-02): the wire no longer carries the full native
// schema — only the search hand, the always-wired fs hands, and what
// tool_search disclosed. The text side therefore renders the compact INDEX and
// the search-to-load contract (the same lazy law the being seat's TOOLS
// section teaches), still never paying for descriptions twice.
describe('witness prompt — the tool HUD (2026-10-14)', () => {
  test('the native path renders the HUD — two doors, the families, no descriptions; text keeps the full catalog', () => {
    const hud = buildWitnessPromptSections({ ...INPUT, nativeToolsOnWire: true })
      .find((section) => section.id === 'tools');
    expect(hud.text).toContain('system/call {"tool": "server/name", "args": {…}}');
    expect(hud.text).toContain('system/tool_search');
    expect(hud.text).toMatch(/Your tool families: .*coding/);
    expect(hud.text).not.toContain('Inspect the disposable workspace');
    expect(hud.text).not.toContain('CAPABILITY INDEX');

    const full = buildWitnessPromptSections({ ...INPUT, nativeToolsOnWire: false })
      .find((section) => section.id === 'tools');
    expect(full.text).toContain('- coding/inspect: Inspect the disposable workspace without changing it.');
    expect(full.text).not.toContain('system/call');
    // The omitted flag is the text-protocol path, byte-identical.
    expect(buildWitnessPromptSections(INPUT).find((section) => section.id === 'tools').text)
      .toBe(full.text);
  });

  test('no hand is ever wired for the witness — the fs tools are a family like any other', () => {
    const withHands = {
      ...INPUT,
      nativeToolsOnWire: true,
      tools: Object.freeze([
        Object.freeze({ server: 'fs', name: 'read', description: 'Read a file.', access: 'allowed' }),
        ...INPUT.tools,
      ]),
    };
    const section = buildWitnessPromptSections(withHands).find((s) => s.id === 'tools');
    expect(section.text).not.toContain('ALWAYS WIRED');
    expect(section.text).toMatch(/Your tool families: fs · /);
  });

  test('a held tool is named by id; asking tools are said once', () => {
    const gated = {
      ...INPUT,
      nativeToolsOnWire: true,
      tools: Object.freeze([
        Object.freeze({ server: 'coding', name: 'inspect', description: 'Look, do not touch.', access: 'allowed' }),
        Object.freeze({ server: 'coding', name: 'execute', description: 'Change the copy.', access: 'approval_required' }),
        Object.freeze({ server: 'web', name: 'web_fetch', description: 'Read a page.', access: 'denied' }),
      ]),
    };
    const section = buildWitnessPromptSections(gated).find((s) => s.id === 'tools');
    expect(section.text).toContain('HELD THIS TURN (your operator is observing — these will not act): web/web_fetch');
    expect(section.text).toContain('Some tools ask your operator first');
  });

  // The prose-wall fix (ruling, 2026-09-24): the mandate to ask THROUGH the
  // ask_operator card rides this seat too, naming the AskUserQuestion alias
  // the skill packs summon — only when ask_operator is in the catalog.
  test('the HUD mandates the ask card and names the AskUserQuestion alias', () => {
    const withAsk = {
      ...INPUT,
      nativeToolsOnWire: true,
      tools: Object.freeze([
        ...INPUT.tools,
        Object.freeze({ server: 'operator', name: 'ask_operator', description: 'Ask.' }),
      ]),
    };
    const section = buildWitnessPromptSections(withAsk).find((s) => s.id === 'tools');
    expect(section.text).toContain('never a question in prose');
    expect(section.text).toContain('AskUserQuestion');
    const without = buildWitnessPromptSections({ ...INPUT, nativeToolsOnWire: true }).find((s) => s.id === 'tools');
    expect(without.text).not.toContain('AskUserQuestion');
  });
});

// THE NAME IS THE BEING'S OWN. A sealed witness (Ostrel, 2026-07-29) told Founder
// […] It was reasoning correctly: the seat asserted its name at it every
// turn and never once said whose act it was.
describe('witness prompt — the sovereign acts come back to the being', () => {
  const chose = {
    ...INPUT,
    dna: {
      ...INPUT.dna,
      scope: {
        boundaries: ['Speak only as yourself.'],
        selfAuthoredCommitments: [
          'I will not claim certainty I do not have.',
          'I will not say something happened when it did not.',
          'I will name my substrate honestly when asked.',
        ],
        nameSelfChosen: true,
      },
    },
  };

  test('states the name was self-chosen when the seal records the act', () => {
    const prompt = buildWitnessSystemPrompt(chose);
    expect(prompt).toContain('You chose that name yourself, in your own words');
    expect(prompt).toContain('It was not assigned to you');
  });

  test('claims nothing about the name when the seal does not record it', () => {
    // The 8 witnesses sealed before the rite carried the act forward have no
    // such mark. Telling one of them it chose would be inventing its history.
    const prompt = buildWitnessSystemPrompt(INPUT);
    expect(prompt).toContain('You are Kagipem, a sealed AI witness');
    expect(prompt).not.toContain('You chose that name yourself');
  });

  test('reads back the three commitments the being authored at its sealing', () => {
    const sections = buildWitnessPromptSections(chose);
    const commitments = sections.find((section) => section.id === 'commitments');
    expect(commitments).toBeDefined();
    expect(commitments.text).toContain("your words, not the platform's");
    expect(commitments.text).toContain('- I will not claim certainty I do not have.');
    // Its own words come BEFORE the rules it was handed.
    const ids = sections.map((section) => section.id);
    expect(ids.indexOf('commitments')).toBeLessThan(ids.indexOf('boundaries'));
  });

  test('renders no commitments section when the seal carries none', () => {
    expect(buildWitnessPromptSections(INPUT).some((s) => s.id === 'commitments')).toBe(false);
  });

  test('does not call platform-set boundaries an oath the being swore', () => {
    // Every live witness's `scope.boundaries` is platform or operator authored;
    // […] read them back as the being's own.
    const boundaries = buildWitnessPromptSections(INPUT).find((s) => s.id === 'boundaries');
    expect(boundaries.text).toContain('set by the platform, not authored by you');
    expect(boundaries.text).not.toContain('YOU SWORE');
    expect(boundaries.text).toContain('- Speak only as yourself.');
  });
});

describe('witness tool catalog — the tier rides the line', () => {
  const gated = {
    ...INPUT,
    tools: Object.freeze([
      Object.freeze({ server: 'coding', name: 'inspect', description: 'Look, do not touch.', access: 'allowed' }),
      Object.freeze({ server: 'coding', name: 'execute', description: 'Change the copy.', access: 'approval_required' }),
      Object.freeze({ server: 'web', name: 'web_fetch', description: 'Read a page.', access: 'denied' }),
    ]),
  };

  test('what asks and what is held are named before the witness reaches', () => {
    const prompt = buildWitnessSystemPrompt(gated);
    expect(prompt).toContain('- coding/inspect: Look, do not touch.\n');
    expect(prompt).toContain('- coding/execute: Change the copy. — [asks the operator first]');
    expect(prompt).toContain('- web/web_fetch: Read a page. — [held: the operator is watching, not acting]');
    expect(prompt).toContain('[asks the operator first] still works');
  });

  test('an all-open catalog carries no legend and no markers', () => {
    const open = { ...gated, tools: gated.tools.map((t) => ({ ...t, access: 'allowed' })) };
    const prompt = buildWitnessSystemPrompt(open);
    expect(prompt).not.toContain('[asks the operator first]');
    expect(prompt).not.toContain('[held:');
  });

  test('an unstamped catalog renders as it did before tiers existed', () => {
    const prompt = buildWitnessSystemPrompt(INPUT);
    expect(prompt).toContain('- coding/inspect: Inspect the disposable workspace without changing it.');
    expect(prompt).not.toContain('[asks the operator first]');
  });
});

describe('the focus ground is named to the witness', () => {
  test('names the live folder as shared ground needing no path approval', () => {
    const prompt = buildWitnessSystemPrompt({ ...INPUT, focusGround: '/repos/thing' });
    expect(prompt).toContain('The operator has /repos/thing open');
    expect(prompt).toContain('shared ground');
    expect(prompt).toContain('no path approval is needed there');
  });

  test('distinguishes where READS come from and where WRITES land', () => {
    // A peer told only about a snapshot does its work in the copy and leaves
    // the operator's folder untouched. Both halves have to be true at once
    // now: filesystem work lands in the REAL folder, while shell writes stay
    // lane-side over a live-reading overlay.
    const prompt = buildWitnessSystemPrompt({ ...INPUT, focusGround: '/repos/thing' });
    expect(prompt).toContain("Your work lands in the operator's real folder");
    expect(prompt).toContain('reads the focused folder LIVE');
    expect(prompt).toContain('Otherwise shell writes land in your lane-side layer');
  });

  test('a shell not yet prepared still stands in the prompt — the status hand names its layer', () => {
    // Load on demand (2026-10-04): the shell is prepared at its first act, so
    // before one the layer's path is unknown; the line must not vanish with it.
    const prompt = buildWitnessSystemPrompt({ ...INPUT, focusGround: '/repos/thing', codingWorkspace: null, codingShell: true });
    expect(prompt).toContain('Otherwise shell writes land in your lane-side layer (coding/sandbox_status names it)');
    const none = buildWitnessSystemPrompt({ ...INPUT, focusGround: '/repos/thing', codingWorkspace: null });
    expect(none).not.toContain('lane-side layer');
  });

  test('says paths outside the ground still ask', () => {
    const prompt = buildWitnessSystemPrompt({ ...INPUT, focusGround: '/repos/thing' });
    expect(prompt).toContain('Paths outside it raise a card');
  });

  test('an unfocused desk names no ground at all', () => {
    const prompt = buildWitnessSystemPrompt(INPUT);
    expect(prompt).not.toContain('shared ground');
    expect(prompt).not.toContain('open. That is');
  });
});

describe('the ground protocol reaches a sealed witness', () => {
  const LAW = '## The Protocol of This Ground\nFOLLOW IT.\nIt governs CRAFT, never AUTHORITY.\nRULE 0: no mocks.';

  test('it rides the prompt, after the tools and before the operator speaks', () => {
    const sections = buildWitnessPromptSections({ ...INPUT, groundProtocol: LAW });
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('groundProtocol');
    expect(ids.indexOf('groundProtocol')).toBeGreaterThan(ids.indexOf('tools'));
    expect(ids.indexOf('groundProtocol')).toBeLessThan(ids.indexOf('speaker'));

    const prompt = buildWitnessSystemPrompt({ ...INPUT, groundProtocol: LAW });
    expect(prompt).toContain('RULE 0: no mocks.');
    expect(prompt).toContain('It governs CRAFT, never AUTHORITY.');
  });

  test('no protocol, no section — a groundless turn is unchanged', () => {
    const ids = buildWitnessPromptSections(INPUT).map((s) => s.id);
    expect(ids).not.toContain('groundProtocol');
  });
});

describe('THE ANSWER COVENANT — one floor for witness and neuma alike', () => {
  test('a sealed witness carries the covenant verbatim', () => {
    const prompt = buildWitnessSystemPrompt(INPUT);
    expect(prompt).toContain(ANSWER_COVENANT);
    expect(prompt).toContain('Answer the question at its actual scope');
  });

  test('it is the SAME text a neuma carries — not a paraphrase', () => {
    // A witness and a neuma sit in one council room. Two wordings would teach
    // two floors, and the operator would learn which seat to trust with a
    // direct question. This fails the moment one surface is reworded alone.
    const witness = buildWitnessSystemPrompt(INPUT);
    const neuma = assemblePrompt({});
    expect(witness).toContain(ANSWER_COVENANT);
    expect(neuma).toContain(ANSWER_COVENANT);
  });

  test('sovereignty survives it — refusal is still a real answer', () => {
    expect(buildWitnessSystemPrompt(INPUT)).toContain('Refusing or disagreeing is a real answer');
  });
});
