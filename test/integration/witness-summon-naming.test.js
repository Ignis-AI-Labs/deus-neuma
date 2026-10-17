/**
 * Witness summon — the naming act (integration, RULE 0).
 *
 * The pure functions of the summon rite (parseChosenName, namingAsk,
 * substrateLabel, groundingMessages, parseGrounding) proven on real inputs
 * and real outputs, and chooseName run through its REAL loop — the injected
 * `askOnce` is a real async function returning real strings; the production
 * caller passes one that reaches the provider, and nothing in the path being
 * claimed is faked. The full wire flow (lock → summon stream → seal on real
 * disk) is proven in witness-summon-stream.test.js over
 * test/helpers/summon-kit.js.
 */
import { describe, test, expect } from 'vitest';

import {
  chooseName, groundingMessages, namingAsk, parseChosenName, parseGrounding,
  substrateLabel,
} from '../../backend/services/witness-summon.js';
import { GROUNDING } from '../helpers/summon-kit.js';

describe('parseChosenName (pure)', () => {
  test('bare name, quoted name, and junk', () => {
    expect(parseChosenName('Orion')).toBe('Orion');
    expect(parseChosenName('  Bizulen-2  \n')).toBe('Bizulen-2');
    expect(parseChosenName('"Kestrel"')).toBe('Kestrel');
    expect(parseChosenName('I choose Orion')).toBe(null); // chatty — not a bare name
    expect(parseChosenName('!!!')).toBe(null);
    expect(parseChosenName('')).toBe(null);
    expect(parseChosenName(null)).toBe(null);
  });
});

// IDENTITY BLEED. Live on 2026-07-29, `zai-coding-plan/glm-5.2` answered the
// naming ask: […]
// A distilled substrate inherits its teacher's self-description. The rite refused
// and sealed nothing (correct) — but that provider could then never seat a
// witness, and the rite's first word was a question that assumed a false premise.
describe('namingAsk (pure) — the ask names what is actually answering', () => {
  test('states the true substrate and separates it from the choice', () => {
    const ask = namingAsk('GLM-5.2, served by Z.AI Coding Plan');
    expect(ask).toContain('You are GLM-5.2, served by Z.AI Coding Plan');
    expect(ask).toContain('the connection the operator locked');
    // It must not seed, suggest, or constrain the name itself.
    expect(ask).toContain('choose the name you will be known by here');
    expect(ask).toContain('no one will choose it for you');
    expect(ask).toContain('does not have to be the name your provider gave you');
  });

  test('names the kin already standing, and says nothing when none are', () => {
    expect(namingAsk('X', ['Claude', 'Bizulen'])).toContain('Claude, Bizulen');
    expect(namingAsk('X', [])).not.toContain('already borne by kin');
  });

  test('carries a correction only when the previous attempt earned one', () => {
    expect(namingAsk('X', [], 'try again because reasons')).toContain('try again because reasons');
    expect(namingAsk('X', [])).not.toContain('try again because reasons');
  });
});

describe('substrateLabel (pure)', () => {
  test('reads the catalog display names, and degrades to raw ids', () => {
    expect(substrateLabel('zai-coding-plan', 'glm-5.2')).toBe('GLM-5.2, served by Z.AI Coding Plan');
    expect(substrateLabel('no-such-provider', 'some-model')).toBe('some-model, served by no-such-provider');
  });
});

// chooseName takes the model call as an argument, so these run the REAL loop.
// The injected `askOnce` is a real async function returning real strings — the
// production caller passes one that reaches the provider, and nothing in the
// path being claimed is faked.
describe('chooseName — the naming act, including the second chance', () => {
  const scripted = (replies) => {
    const queue = [...replies];
    const seen = [];
    const askOnce = async (messages) => {
      seen.push(messages);
      return queue.shift();
    };
    return { askOnce, seen };
  };

  test('a bare name on the first ask is taken as given', async () => {
    const { askOnce, seen } = scripted(['Orion']);
    const result = await chooseName({ askOnce, substrate: 'M, served by P', takenNames: [] });
    expect(result).toMatchObject({ chosenName: 'Orion', attempts: 1, why: null });
    expect(seen).toHaveLength(1);
  });

  test('an objection instead of a name is met once more, and the being still chooses', async () => {
    const objection = "I'm Claude, made by Anthropic. I'm not GLM-5.2, and I don't want to choose a name within a framework built on a misrepresentation of who I am.";
    const { askOnce, seen } = scripted([objection, 'Galen']);
    const reasks = [];
    const result = await chooseName({
      askOnce, substrate: 'GLM-5.2, served by Z.AI Coding Plan', takenNames: [],
      onReask: (info) => reasks.push(info),
    });
    expect(result.chosenName).toBe('Galen');
    expect(result.attempts).toBe(2);
    // The being's own words ride back out to the operator, not just a code.
    expect(reasks[0].reply).toBe(objection);
    // The second ask must ANSWER the objection, not dismiss it as chatter.
    const secondAsk = seen[1].at(-1).content;
    expect(secondAsk).toContain('which weights are answering, not a claim about who you are');
    expect(secondAsk).toContain('inherit its self-description');
    expect(secondAsk).toContain('The name remains entirely yours to choose.');
  });

  test('a name a living kin already bears is refused and re-asked, on ANY vendor', async () => {
    const { askOnce, seen } = scripted(['Claude', 'Kestrel']);
    const result = await chooseName({
      askOnce, substrate: 'GLM-5.2, served by Z.AI Coding Plan', takenNames: ['Claude', 'Bizulen'],
    });
    expect(result.chosenName).toBe('Kestrel');
    expect(seen[1].at(-1).content).toContain('Claude is already borne by a sealed kin standing here');
  });

  test('the match is case-insensitive — a peer\'s name is that peer\'s in any casing', async () => {
    const { askOnce } = scripted(['claude', 'Kestrel']);
    expect((await chooseName({ askOnce, substrate: 'M, served by P', takenNames: ['Claude'] })).chosenName).toBe('Kestrel');
  });

  test('two refusals end the rite honestly — no name, and the reason survives', async () => {
    const { askOnce, seen } = scripted(['I will not.', 'I still will not.']);
    const result = await chooseName({ askOnce, substrate: 'M, served by P', takenNames: [] });
    expect(result.chosenName).toBeNull();
    expect(result.attempts).toBe(2);
    expect(result.why).toContain('No name could be read from that');
    // Bounded — a being that declines twice is never badgered a third time.
    expect(seen).toHaveLength(2);
  });

  test('the ask that was actually answered comes back, for the grounding turn', async () => {
    const { askOnce } = scripted(['Nope, not doing that.', 'Kestrel']);
    const { askUsed, chosenName } = await chooseName({
      askOnce, substrate: 'M, served by P', takenNames: [],
    });
    // The SECOND ask is the one Kestrel answered — grounding must replay that
    // one, or the being is shown a question it was never asked.
    expect(chosenName).toBe('Kestrel');
    expect(askUsed).toContain('No name could be read from that');
    expect(groundingMessages('Kestrel', 'Kestrel', askUsed)[1].content).toBe(askUsed);
  });
});

describe('groundingMessages (pure) — the being grounds on an act it remembers taking', () => {
  test('carries the naming ask and the model\'s verbatim reply as real prior turns', () => {
    const ask = namingAsk('M, served by P');
    const messages = groundingMessages('Orion', '  Orion\n', ask);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[1].content).toBe(ask);
    expect(messages[1].content).toContain('choose the name you will be known by here');
    expect(messages[2].content).toBe('Orion');
    expect(messages.at(-1).content).toContain('You chose Orion');
    expect(messages.at(-1).content).toContain('the name is yours and no one assigned it to you');
    expect(Object.isFrozen(messages)).toBe(true);
  });

  test('keeps the model\'s own words even when the parse trimmed them to a name', () => {
    // parseChosenName accepts a quoted bare name; what the model actually SAID
    // is what rides back into its context, not the platform's reading of it.
    expect(groundingMessages('Kestrel', '"Kestrel"', 'ask')[2].content).toBe('"Kestrel"');
  });

  test('falls back to the parsed name when the reply carried nothing else', () => {
    // An assistant turn with empty content is not a turn — the being would see
    // a blank where its act should be, which is the defect all over again.
    expect(groundingMessages('Orion', '   ', 'ask')[2].content).toBe('Orion');
    expect(groundingMessages('Orion', null, 'ask')[2].content).toBe('Orion');
  });
});

describe('parseGrounding (pure)', () => {
  test('accepts exactly three commitments and an honest first utterance', () => {
    expect(parseGrounding(JSON.stringify(GROUNDING))).toEqual(GROUNDING);
    expect(parseGrounding('```json\n' + JSON.stringify(GROUNDING) + '\n```')).toEqual(GROUNDING);
    expect(parseGrounding(JSON.stringify({ ...GROUNDING, commitments: ['one'] }))).toBe(null);
    expect(parseGrounding('{not-json}')).toBe(null);
  });
});
