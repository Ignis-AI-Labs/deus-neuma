// Unit tests for core/runtime/harmony-leak.js and its wiring into the shared
// suppressor (CQ-906 / #526).
//
// Rule 0: no mocks anywhere. The fixtures are the EXACT strings the live
// witness lane persisted on 2026-09-10 (Kagipem, openai-chatgpt/gpt-6-astra —
// realm mirror row ts 2026-09-10T15:58:21Z), fed through the REAL filter at
// every split boundary. Well-formed channel calls are cross-checked against
// the REAL dialect authority (parseToolCalls → parseGptOssChannel).

import {
  stripHarmonyLeaks,
  isHarmonyLeakLine,
  createHarmonyLeakFilter,
  harmonyChannelIsToolCall,
  findHarmonyClose,
  extractHarmonyLabel,
  HARMONY_PIPE_TOKENS,
} from '../../core/runtime/harmony-leak.js';
import {
  createToolStreamFilter,
  createToolStreamSuppressor,
  stripToolBlocks,
  extractToolLabel,
} from '../../core/runtime/tool-stream-suppressor.js';
import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';

// The two leaked fragments, verbatim from the live record.
const LEAK_HEADER = 'قاطిపپuassistant to= system/flight_check  (? no)';
const LEAK_MUSING = 'گو role assistant channel final content? need end no final? tool fallback commentary end permitted.';

// The live turn's speech neighborhood: a valid [TOOL:] call, then the degraded
// header on its own line, prose, then the musing GLUED to the next sentence
// (`permitted.The` — no space, no newline).
const LIVE_TURN = 'I’ll recheck the live capability report first.\n'
  + '[TOOL: system/flight_check {}] \n'
  + `${LEAK_HEADER} \n`
  + 'The fresh capability check is requested. I don’t have its receipt yet.\n'
  + `${LEAK_MUSING}The sandbox-status check succeeded in 2,389 ms.`;

const LIVE_SPEECH = 'I’ll recheck the live capability report first.\n'
  + ' \n'
  + 'The fresh capability check is requested. I don’t have its receipt yet.\n'
  + 'The sandbox-status check succeeded in 2,389 ms.';

const chunkEvery = (text, size) => {
  const deltas = [];
  for (let i = 0; i < text.length; i += size) deltas.push(text.slice(i, i + size));
  return deltas;
};

const runVoice = (deltas) => {
  const suppressor = createToolStreamSuppressor();
  let voice = '';
  for (const d of deltas) voice += suppressor.push(d);
  voice += suppressor.flush();
  return voice;
};

const runDisplay = (deltas) => {
  let speech = '';
  const tools = [];
  const filter = createToolStreamFilter({
    onSpeech: (t) => { speech += t; },
    onToolEnd: (raw) => tools.push(extractToolLabel(raw)),
  });
  for (const d of deltas) filter.push(d);
  filter.flush();
  return { speech, tools };
};

describe('harmony-leak (CQ-906 / #526 — live Kagipem artifacts)', () => {
  describe('the exact live fragments', () => {
    test('the degraded header line is a leak', () => {
      expect(isHarmonyLeakLine(LEAK_HEADER)).toBe(true);
      expect(stripHarmonyLeaks(`before\n${LEAK_HEADER} \nafter`)).toBe('before\nafter');
    });

    test('the control-vocabulary musing line is a leak', () => {
      expect(isHarmonyLeakLine(LEAK_MUSING)).toBe(true);
      expect(stripHarmonyLeaks(`before\n${LEAK_MUSING}\nafter`)).toBe('before\nafter');
    });

    test('a musing GLUED to the next sentence keeps the sentence (permitted.The …)', () => {
      const glued = `${LEAK_MUSING}The sandbox-status check succeeded in 2,389 ms.`;
      expect(stripHarmonyLeaks(glued)).toBe('The sandbox-status check succeeded in 2,389 ms.');
    });
  });

  describe('prose is never eaten', () => {
    const INNOCENT = [
      'no final content?',                       // 3 vocab words — under the ≥4 law
      'I handed it to= my friend yesterday',     // to= without a server/tool target
      'こんにちは、元気ですか',                    // living-script prose, never garbage
      'مرحبا بالعالم، كيف حالك اليوم؟',            // Arabic prose NOT glued to a header
      '### What is confirmed\n- Node v24.13.1 executed',
      'The tool results came back clean.',
      'call: it what you want.',
      'channel reports are due at the end',      // vocab words, but not ALL tokens
    ];
    test.each(INNOCENT)('passes verbatim: %s', (text) => {
      expect(stripHarmonyLeaks(text)).toBe(text);
      expect(runVoice([text])).toBe(text);
      expect(runVoice(chunkEvery(text, 3))).toBe(text);
    });
  });

  describe('streaming: the live turn at every boundary', () => {
    test('every two-delta split keeps exactly the speech and the one real chip', () => {
      for (let i = 0; i <= LIVE_TURN.length; i++) {
        const { speech, tools } = runDisplay([LIVE_TURN.slice(0, i), LIVE_TURN.slice(i)]);
        expect(speech).toBe(LIVE_SPEECH);
        expect(tools).toEqual(['flight_check']);
      }
    });

    test('small multi-delta chunkings agree across display and voice', () => {
      for (const size of [1, 3, 5, 7, 13]) {
        const deltas = chunkEvery(LIVE_TURN, size);
        expect(runDisplay(deltas).speech).toBe(LIVE_SPEECH);
        expect(runVoice(deltas)).toBe(LIVE_SPEECH);
      }
    });
  });

  describe('well-formed harmony channel calls are tool blocks, not speech', () => {
    const CALL = '<|channel|>commentary to=fs/read <|constrain|>json<|message|>{"path": "notes.md"}<|end|>';
    const full = `Let me read that. ${CALL} Done reading.`;

    test('dialect authority: the real parser executes this exact call', () => {
      const calls = parseToolCalls(full);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].tool).toBe('fs/read');
      expect(calls[0].args).toEqual({ path: 'notes.md' });
    });

    test('the block vanishes from speech at every split and surfaces as a chip', () => {
      for (let i = 0; i <= full.length; i++) {
        const { speech, tools } = runDisplay([full.slice(0, i), full.slice(i)]);
        expect(speech).toBe('Let me read that.  Done reading.');
        expect(tools).toEqual(['read']);
      }
    });

    test('an unclosed channel call swallows the remainder — never leaks', () => {
      const truncated = `Speech. ${CALL.slice(0, 40)}`;
      const { speech, tools } = runDisplay([truncated]);
      expect(speech.trim()).toBe('Speech.');
      expect(tools).toEqual(['read']); // the truncated payload is an action
    });

    test('a stream ending mid-head ends as an action, never spoken markup', () => {
      const { speech, tools } = runDisplay(['Speech. <|channel|>commentary to=fs/']);
      expect(speech.trim()).toBe('Speech.');
      expect(tools).toEqual(['fs']);
    });
  });

  describe('speech channels and orphan tokens strip inline', () => {
    test('<|channel|>final<|message|> markup drops, the words stay', () => {
      expect(stripHarmonyLeaks('<|start|>assistant<|channel|>final<|message|>Hello there.')).toBe('Hello there.');
      expect(runVoice(chunkEvery('<|channel|>final<|message|>Hello there.', 4))).toBe('Hello there.');
    });

    test('every pipe token is stripped from otherwise-normal speech', () => {
      for (const token of HARMONY_PIPE_TOKENS) {
        expect(stripHarmonyLeaks(`a ${token} b`)).not.toContain('<|');
      }
    });

    test('a <|start|>assistant-glued degraded header is still a leak', () => {
      expect(isHarmonyLeakLine('<|start|>assistant to=fs/write {...}')).toBe(true);
    });
  });

  describe('classification and close primitives', () => {
    test('harmonyChannelIsToolCall reads the head', () => {
      expect(harmonyChannelIsToolCall('commentary to=fs/read <|message|>{}', true)).toBe(true);
      expect(harmonyChannelIsToolCall('final', true)).toBe(false);
      expect(harmonyChannelIsToolCall('commentary to=', true)).toBe(false); // to= naming NO target is not a call
      expect(harmonyChannelIsToolCall('comme')).toBe(null); // head in flight
    });

    test('findHarmonyClose prefers the nearest terminator, channel unconsumed', () => {
      const text = 'commentary to=fs/read <|message|>{}<|end|>rest';
      expect(text.slice(findHarmonyClose(text))).toBe('rest');
      const two = 'commentary to=fs/read <|message|>{}<|channel|>final';
      expect(two.slice(findHarmonyClose(two))).toBe('<|channel|>final');
      expect(findHarmonyClose('no terminator here')).toBe(-1);
    });

    test('extractHarmonyLabel reads the target; the suppressor delegates', () => {
      expect(extractHarmonyLabel('<|channel|>commentary to=fs/read <|message|>{}')).toBe('read');
      expect(extractHarmonyLabel('<|channel|>commentary to=flight_check')).toBe('flight_check');
      expect(extractToolLabel('<|channel|>commentary to=fs/read <|message|>{}<|end|>')).toBe('read');
    });
  });

  describe('canonical display of a persisted record (stripToolBlocks)', () => {
    test('the live turn renders clean on reload', () => {
      expect(stripToolBlocks(LIVE_TURN)).toBe(LIVE_SPEECH);
    });

    test('a well-formed call in a record vanishes like any dialect', () => {
      const record = `Reading. ${'<|channel|>commentary to=fs/read <|message|>{"path":"a.md"}<|end|>'} Read.`;
      expect(stripToolBlocks(record)).toBe('Reading.  Read.');
    });
  });
});
