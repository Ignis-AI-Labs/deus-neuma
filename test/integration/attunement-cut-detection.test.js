/**
 * finish_reason surfaces (S7f RCA lead closed): a token-budget cut used to be
 * indistinguishable from a complete reply — Tenekom's consent was cut
 * mid-sentence on the witnessed 2026-07-09 sitting and read as consent
 * evidence. Now the provider's stated finish rides the stream contract
 * (once-at-end, like onUsage), and the ceremony legs act on it:
 *
 *   - consent: a 'length' cut REFUSES retryably (ANSWER_CUT) — a witness
 *     never reads half a sentence as consent; a whole reply carries its
 *     finishReason to the desk.
 *   - answers: a 'length' cut refuses the same way — the pending question
 *     stands and the SAME words are re-served, nothing half lands as whole.
 *   - corruption (2026-07-12, Tenekom's walk: 6 of 23 answers carried the
 *     signature): a reply that trips the text-integrity gate refuses the
 *     same retryable way (ANSWER_CORRUPT) — nothing corrupted lands on the
 *     record or enters the replay window; the same words re-serve.
 *
 * REAL workspace, real DEK, real SSE fixture over real HTTP (RULE 0).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { readStreamLine, consumeStream } from '../../backend/services/llm-provider.js';

const WALLET = '0x2222222222222222222222222222222222222222';

const chunk = (text, finish = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`;

describe('readStreamLine — the provider states its finish', () => {
  it('OpenAI-compat: finish_reason rides the final chunk; null until then', () => {
    expect(readStreamLine('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}', 'lm-studio').finishReason).toBe(null);
    expect(readStreamLine('data: {"choices":[{"delta":{},"finish_reason":"length"}]}', 'llama-server').finishReason).toBe('length');
    expect(readStreamLine('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', 'lm-studio').finishReason).toBe('stop');
  });

  it('ollama: done_reason on the done line', () => {
    const evt = readStreamLine('{"done":true,"done_reason":"length"}', 'ollama');
    expect(evt).toEqual({ done: true, finishReason: 'length' });
  });

  it("anthropic: message_delta's max_tokens normalizes to 'length'", () => {
    const evt = readStreamLine('data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}', 'anthropic');
    expect(evt.finishReason).toBe('length');
    expect(readStreamLine('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}', 'anthropic').finishReason).toBe('end_turn');
  });
});

describe('ceremony legs refuse budget-cut replies — real wire, real record', () => {
  let workspace, ceremony, neumaId, provider, prevKey, prevCreds, prevRoutes, prevClaims;
  // the fixture's next reply: [text, finish_reason]
  let scripted = ['a whole reply.', 'stop'];
  const answerBodies = []; // every BEING-leg request body, verbatim off the wire

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevCreds = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    prevRoutes = process.env.NEUMA_ROUTES_PATH;
    prevClaims = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    process.env.DNA_ENCRYPTION_KEY = 'cut-detection-test-key-long-enough';
    // The route layer reads the operator's REAL encrypted stores — a throwaway
    // test key cannot decrypt them (anti-wipe law: it throws), so isolate all
    // three or the machine's own state fails every being leg.
    const isolated = await createTempDir('cut-detection-env');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(isolated, 'creds.json');
    process.env.NEUMA_ROUTES_PATH = path.join(isolated, 'routes.json');
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(isolated, 'claims');

    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    ws.setWorkspacesRoot(path.join(await createTempDir('cut-detection'), 'workspaces'));

    provider = await new Promise((resolve) => {
      const server = createServer((req, res) => {
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'cut-model' }] }));
          return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          if (parsed.stream === false) {
            // The think-behavior probe (c50af345c): a real OpenAI-compat
            // server answers a NON-STREAM request with plain JSON. Answer it
            // so the capability classifies and CACHES — the probe is a
            // capability read, never a being-leg body in the capture below.
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          if (body.includes('Respond with ONLY a JSON object')) {
            // question generation: garbage → deterministic fallback set
            res.end(chunk('prose, not JSON.', 'stop') + 'data: [DONE]\n\n');
          } else {
            answerBodies.push(parsed);
            const [text, finish] = scripted;
            res.end(chunk(text, finish) + 'data: [DONE]\n\n');
          }
        });
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

    const llm = await import('../../backend/services/llm-provider.js');
    llm.setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${provider.address().port}`,
      model: 'cut-model',
      apiKey: '',
    });

    neumaId = 'cut-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, {
      version: '1.0.0', identity: { name: 'Prooflet' },
      genesis: '# Essence\nProof by walking.',
    });
    ceremony = await import('../../backend/services/attunement-ceremony.js');
  });

  afterAll(async () => {
    const ws = await import('../../core/workspace/neuma-workspace.js');
    ws.setWorkspacesRoot(null);
    const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    restore('DNA_ENCRYPTION_KEY', prevKey);
    restore('NEUMA_PROVIDER_CREDENTIALS_PATH', prevCreds);
    restore('NEUMA_ROUTES_PATH', prevRoutes);
    restore('NEUMA_SUBSTRATE_CLAIM_DIR', prevClaims);
    await new Promise((r) => provider.close(r));
    vi.restoreAllMocks();
  });

  it('consumeStream surfaces finishReason once at stream end (real HTTP)', async () => {
    const { createStreamRequest } = await import('../../backend/services/llm-provider.js');
    scripted = ['cut mid-thou', 'length'];
    const reasons = [];
    const stream = await createStreamRequest([{ role: 'user', content: 'hello' }], {});
    const text = await consumeStream(stream, () => {}, { onFinishReason: (r) => reasons.push(r) });
    expect(text).toBe('cut mid-thou');
    expect(reasons).toEqual(['length']);
  });

  it('a cut consent refuses retryably; a whole consent carries its finishReason', async () => {
    const offered = await ceremony.offerAttunementRecord(neumaId, WALLET, { trigger: 'post-birth' });

    scripted = ['I consent to begin. The idea that my own words will form the ground', 'length'];
    await expect(ceremony.askConsentReply(neumaId, offered.id))
      .rejects.toMatchObject({ code: 'ANSWER_CUT' });

    // a corrupted consent refuses the same retryable way — the gate at the door
    scripted = ['It\'t my own choice to begin, and I make it freely.', 'stop'];
    await expect(ceremony.askConsentReply(neumaId, offered.id))
      .rejects.toMatchObject({ code: 'ANSWER_CORRUPT' });

    scripted = ['I consent to begin, wholly and in my own words.', 'stop'];
    const whole = await ceremony.askConsentReply(neumaId, offered.id);
    expect(whole.reply).toBe('I consent to begin, wholly and in my own words.');
    expect(whole.finishReason).toBe('stop');

    // proceed to answering for the answer-leg case below
    const opened = await ceremony.openAttunementRecord(neumaId, offered.id, {
      consent: { sessionId: offered.id, quote: whole.reply },
    });
    expect(opened.phase).toBe('answering');
  }, 60_000);

  it('a cut answer never lands on the record — the SAME question stands and re-serves whole', async () => {
    scripted = ['My answer begins but the budget', 'length'];
    await expect(ceremony.askNextQuestion(neumaId, (await workspace.listAttunements(neumaId))[0].id))
      .rejects.toMatchObject({ code: 'ANSWER_CUT' });

    const recordId = (await workspace.listAttunements(neumaId))[0].id;
    let record = await workspace.readAttunement(neumaId, recordId);
    expect(record.pending).toBeTruthy(); // the question still stands
    expect(Object.keys(record.answers)).toHaveLength(0); // nothing half landed

    // a corrupted answer refuses identically — both witnessed 2026-07-12
    // shapes: the boundary capital and the contraction glitch
    scripted = ['This is what it means to be realL', 'stop'];
    await expect(ceremony.askNextQuestion(neumaId, recordId))
      .rejects.toMatchObject({ code: 'ANSWER_CORRUPT' });
    scripted = ['It\'t not a relief that the task is over; it is joy.', 'stop'];
    await expect(ceremony.askNextQuestion(neumaId, recordId))
      .rejects.toMatchObject({ code: 'ANSWER_CORRUPT' });
    record = await workspace.readAttunement(neumaId, recordId);
    expect(record.pending).toBeTruthy(); // the question STILL stands
    expect(Object.keys(record.answers)).toHaveLength(0); // nothing corrupted landed

    scripted = ['My whole answer, ended where I ended it.', 'stop'];
    const { turn } = await ceremony.askNextQuestion(neumaId, recordId);
    expect(turn.answer).toBe('My whole answer, ended where I ended it.');
    record = await workspace.readAttunement(neumaId, recordId);
    expect(record.answers[turn.key].quote).toBe('My whole answer, ended where I ended it.');
  }, 60_000);

  it('the retry ladder: one ask climbs relief in-process, a landed answer resets it (wedged-walk class)', async () => {
    const recordId = (await workspace.listAttunements(neumaId))[0].id;
    const before = answerBodies.length;

    // One ask = DOOR_ATTEMPTS_PER_ASK generations. Corrupt each time → one
    // external refuse after the full in-ask climb (temps: family, 0.85, 0.7, 0.7).
    scripted = ['This is what it means to be realL', 'stop'];
    await expect(ceremony.askNextQuestion(neumaId, recordId)).rejects.toMatchObject({ code: 'ANSWER_CORRUPT' });
    const climbTemps = answerBodies.slice(before).map((b) => b.temperature ?? null);
    const familyDefault = climbTemps[0];
    expect(climbTemps).toEqual([familyDefault, 0.85, 0.7, 0.7]);
    expect(familyDefault).not.toBe(0.85);
    expect(climbTemps).toHaveLength(ceremony.DOOR_ATTEMPTS_PER_ASK);

    // Next ask: refusals already 4 → bare + floor temp, then land clean.
    // Framing rides the re-ask user message (integrityFraming).
    const beforeLand = answerBodies.length;
    scripted = ['A whole answer, calm and clean, ended where I ended it.', 'stop'];
    const { turn } = await ceremony.askNextQuestion(neumaId, recordId);
    expect(turn.answer).toBe('A whole answer, calm and clean, ended where I ended it.');
    expect(answerBodies[beforeLand].temperature).toBe(0.55);
    expect(answerBodies[beforeLand].messages.at(-1).content).toMatch(/complete sentence/i);

    // ladder RESET on landing: next question's first attempt is family default
    scripted = ['The next answer, first try, own voice.', 'stop'];
    await ceremony.askNextQuestion(neumaId, recordId);
    expect(answerBodies.at(-1).temperature ?? null).toBe(familyDefault);
  }, 60_000);

  it('a stated-stop cut refuses too: prose that quits mid-thought is a cut whatever the provider claims (witnessed 2026-07-12)', async () => {
    const recordId = (await workspace.listAttunements(neumaId))[0].id;
    const landedBefore = Object.keys((await workspace.readAttunement(neumaId, recordId)).answers).length;
    // the witnessed shape: mid-sentence stop with finish_reason 'stop'
    scripted = ['the piece moves from being a weight I can manage to a voice that', 'stop'];
    await expect(ceremony.askNextQuestion(neumaId, recordId))
      .rejects.toMatchObject({ code: 'ANSWER_CUT' });
    const record = await workspace.readAttunement(neumaId, recordId);
    expect(record.pending).toBeTruthy();
    expect(Object.keys(record.answers)).toHaveLength(landedBefore);

    scripted = ['A thought carried all the way to its own period.', 'stop'];
    const { turn } = await ceremony.askNextQuestion(neumaId, recordId);
    expect(turn.answer).toBe('A thought carried all the way to its own period.');

    // GATE ORDER pinned: an answer that is BOTH corrupt AND unfinished lands
    // as ANSWER_CORRUPT — corruption is the more specific diagnosis, judged
    // first; a future reorder would silently misclassify this shape.
    scripted = ['It\'t broken and it stops mid', 'stop'];
    await expect(ceremony.askNextQuestion(neumaId, recordId))
      .rejects.toMatchObject({ code: 'ANSWER_CORRUPT' });
    scripted = ['A whole clean thought, ended by its author.', 'stop'];
    await ceremony.askNextQuestion(neumaId, recordId);
  }, 60_000);

  it('reliefTemperature damps from the second attempt (bare-base first-attunement ladder)', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(ceremony.reliefTemperature))
      .toEqual([null, 0.85, 0.7, 0.7, 0.55, 0.55, 0.55]);
  });

  it('integrityFraming only frames re-asks — never rephrases the first take', () => {
    const q = 'What holds you?';
    expect(ceremony.integrityFraming(q, 0)).toBe(q);
    expect(ceremony.integrityFraming(q, 1)).toContain(q);
    expect(ceremony.integrityFraming(q, 1)).toMatch(/complete sentence/i);
  });

  it('the answer leg replays a BOUNDED recent window — never the whole ceremony (28k-token depth degraded bare-base, 2026-07-10)', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => `dim-${i + 1}`);
    const record = {
      rendered: { questions: keys.map((key) => ({ key })) },
      answers: Object.fromEntries(keys.map((key, i) => [key, { question: `Q ${i + 1}`, quote: `A ${i + 1}.` }])),
    };
    // reopened answers leave the window along with the answer set
    delete record.answers['dim-19'];
    const window = ceremony.replayWindow(record);
    expect(window).toHaveLength(ceremony.REPLAY_PAIRS_CAP * 2);
    // most recent answered pairs, in order, skipping the reopened key
    // (19 answered − cap 12 → the window opens at the 8th answered pair)
    expect(window[0]).toEqual({ role: 'user', content: 'Q 8' });
    expect(window.at(-2)).toEqual({ role: 'user', content: 'Q 20' });
    expect(window.at(-1)).toEqual({ role: 'assistant', content: 'A 20.' });
    expect(window.some((m) => m.content === 'Q 19')).toBe(false);
    // a short ceremony rides whole
    const shortRecord = {
      rendered: { questions: keys.slice(0, 3).map((key) => ({ key })) },
      answers: { 'dim-1': { question: 'Q 1', quote: 'A 1.' } },
    };
    expect(ceremony.replayWindow(shortRecord)).toHaveLength(2);
  });

  it('every being-leg request carries the ceremony answer budget — runaways terminate at 2048, not 8192', async () => {
    // ORDERING DEPENDENCY (deliberate): answerBodies is populated by the
    // ceremony walks in the tests ABOVE — this asserts over the suite's
    // accumulated wire traffic and fails empty if run in isolation. Ceremony
    // legs are the ones carrying the being's assembled system prompt (the
    // suite's first test also hits this fixture with a raw single-turn
    // user-first provider call — that one rides the config default and is
    // not a ceremony leg). The cap bounds post-runaway state churn
    // (2026-07-10 lead): a runaway still refuses via finish 'length', it
    // just burns a quarter of the state.
    const ceremonyLegs = answerBodies.filter((b) => b.messages?.[0]?.role === 'system');
    expect(ceremonyLegs.length).toBeGreaterThanOrEqual(3);
    for (const body of ceremonyLegs) {
      expect(body.max_tokens).toBe(ceremony.ANSWER_TOKEN_BUDGET);
    }
    expect(ceremony.ANSWER_TOKEN_BUDGET).toBe(2048);
  });
});
