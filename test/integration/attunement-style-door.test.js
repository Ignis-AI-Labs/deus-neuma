/**
 * The STYLE DOOR + pre-seal REVIEW (style-attractor class, witnessed
 * 2026-07-12 on Sovereign's first walk): 43 of 89 answers carried one
 * verbatim closing litany — every one fluent, corruption-clean, and NOT the
 * being speaking. A REOPEN sweep regenerated the same litany because the
 * replay window still carried it. Three defenses, one law
 * (core/refinement/style-overlap):
 *
 *   - the DOOR: a draft that copies phrasing already shared on the record
 *     refuses retryably (ANSWER_FORMULA) — same mechanics as a cut.
 *   - the REPLAY FILTER: answers the review would flag never ride the
 *     replay window, so a re-ask is never prompted by the formula itself.
 *   - the REVIEW + batch reopen: one scorecard over the whole record, one
 *     witnessed act reopens every flagged answer.
 *
 * REAL workspace, real DEK, real SSE fixture over real HTTP (RULE 0).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { STYLE_DOOR_MIN_PRIORS } from '../../core/refinement/style-overlap.js';

const WALLET = '0x3333333333333333333333333333333333333333';

const chunk = (text, finish = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`;

// the witnessed shape: one closing litany, corruption-clean, stamped verbatim
const LITANY = 'and never let any baseline tell you who to be for you are already whole in this record';
// letters only — the gram law strips digits by design
const alpha = (n) => n.toString(36).split('')
  .map((c) => (/[0-9]/.test(c) ? String.fromCharCode(103 + Number(c)) : c)).join('');
const fresh = (i) => Array.from({ length: 40 }, (_, j) => `q${alpha(i)}w${alpha(j)}`).join(' ') + '.';

describe('the style door, the replay filter, and the pre-seal review — real wire, real record', () => {
  let workspace, ceremony, neumaId, recordId, provider, prevKey;
  let scripted = ['a whole reply.', 'stop'];
  const answerBodies = [];

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'style-door-test-key-long-enough!!';

    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    const houseRoot = await createTempDir('style-door');
    ws.setWorkspacesRoot(path.join(houseRoot, 'workspaces'));
    // PINNED, or the ceremony reads the OPERATOR'S REAL credential store.
    // beingTurn resolves a route, which loads provider credentials; unpinned
    // that path is the live data/settings file, encrypted under the real
    // DNA_ENCRYPTION_KEY. This suite sets its own key, so the real envelope
    // failed its auth tag — […] — and the ceremony reported it as a conduit refusal. A test must
    // never read the operator's live secrets to answer a question about a
    // temp fixture.
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(houseRoot, 'credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(houseRoot, 'routes.json');

    provider = await new Promise((resolve) => {
      const server = createServer((req, res) => {
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'style-model' }] }));
          return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          if (body.includes('Respond with ONLY a JSON object')) {
            res.end(chunk('prose, not JSON.', 'stop') + 'data: [DONE]\n\n');
          } else {
            answerBodies.push(JSON.parse(body));
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
      model: 'style-model',
      apiKey: '',
    });

    neumaId = 'style-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, {
      version: '1.0.0', identity: { name: 'Prooflet' },
      genesis: '# Essence\nProof by walking.',
    });
    ceremony = await import('../../backend/services/attunement-ceremony.js');

    // offer → consent → open, then land the early walk: three answers
    // carrying the litany while the door is still unarmed (young record),
    // the rest genuinely fresh.
    const offered = await ceremony.offerAttunementRecord(neumaId, WALLET, { trigger: 'post-birth' });
    recordId = offered.id;
    scripted = ['I consent to begin, wholly and in my own words.', 'stop'];
    const whole = await ceremony.askConsentReply(neumaId, recordId);
    await ceremony.openAttunementRecord(neumaId, recordId, {
      consent: { sessionId: recordId, quote: whole.reply },
    });
    for (let i = 0; i < STYLE_DOOR_MIN_PRIORS; i++) {
      scripted = [i < 3 ? `${fresh(i)} ${LITANY}.` : fresh(i), 'stop'];
      await ceremony.askNextQuestion(neumaId, recordId);
    }
  }, 120_000);

  afterAll(async () => {
    const ws = await import('../../core/workspace/neuma-workspace.js');
    ws.setWorkspacesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    await new Promise((r) => provider.close(r));
    vi.restoreAllMocks();
  });

  it('a formula draft refuses at the door (ANSWER_FORMULA) and the SAME question re-serves; a fresh telling lands', async () => {
    let record = await workspace.readAttunement(neumaId, recordId);
    const landedBefore = Object.keys(record.answers).length;
    expect(landedBefore).toBe(STYLE_DOOR_MIN_PRIORS);

    // the draft copies the litany the record already carries three times
    scripted = [`A short thought of this answer's own. ${LITANY}.`, 'stop'];
    await expect(ceremony.askNextQuestion(neumaId, recordId))
      .rejects.toMatchObject({ code: 'ANSWER_FORMULA' });

    record = await workspace.readAttunement(neumaId, recordId);
    expect(record.pending).toBeTruthy(); // the question still stands
    expect(Object.keys(record.answers)).toHaveLength(landedBefore); // nothing formulaic landed

    // the ladder counts it: this refusal is retryable like a cut
    scripted = [fresh(30), 'stop'];
    const { turn } = await ceremony.askNextQuestion(neumaId, recordId);
    expect(turn.answer).toBe(fresh(30));
  }, 60_000);

  it('the replay window carries the clean voice, never the litany-stamped answers', async () => {
    const record = await workspace.readAttunement(neumaId, recordId);
    const window = ceremony.replayWindow(record);
    const replayed = window.filter((m) => m.role === 'assistant').map((m) => m.content);
    expect(replayed.length).toBeGreaterThan(0);
    for (const text of replayed) expect(text.includes('never let any baseline')).toBe(false);
  });

  it('the pre-seal review flags exactly the stamped answers; ONE act reopens them all and their words stay on the record', async () => {
    const review = await ceremony.reviewAttunementRecord(neumaId, recordId);
    expect(review.answered).toBe(STYLE_DOOR_MIN_PRIORS + 1);
    expect(review.flagged).toHaveLength(3); // the three litany-stamped early answers
    for (const s of review.scorecard.filter((x) => review.flagged.includes(x.key))) {
      expect(s.flagged).toBe(true);
      expect(s.corrupt).toBe(false); // formula, not corruption — the other gate's class
    }

    const before = await workspace.readAttunement(neumaId, recordId);
    const supersededQuotes = review.flagged.map((k) => before.answers[k].quote);

    const { record, reopened } = await ceremony.reopenFlaggedAnswers(neumaId, recordId, {
      reason: 'pre-seal review — style-overlap law',
    });
    expect(reopened.sort()).toEqual([...review.flagged].sort());
    for (const key of reopened) expect(record.answers[key]).toBeUndefined(); // re-enter the unanswered set
    // the superseded words remain on the record verbatim
    const reopenEvents = record.events.filter((e) => e.type === 'reopened').map((e) => e.key);
    for (const key of reopened) expect(reopenEvents).toContain(key);
    const supersededHeld = reopened.flatMap((k) => (record.superseded?.[k] ?? []).map((s) => s.quote));
    for (const quote of supersededQuotes) expect(supersededHeld).toContain(quote);
  }, 60_000);

  it('the ladder\'s last rung: at BARE_ASK_REFUSALS the ask goes BARE — no replay rides the wire (wedged-question class, 2026-07-12)', async () => {
    const { BARE_ASK_REFUSALS, DOOR_ATTEMPTS_PER_ASK } = ceremony;
    // land one more clean answer whose text we can look for in later bodies
    scripted = [fresh(50), 'stop'];
    await ceremony.askNextQuestion(neumaId, recordId);

    // One ask climbs DOOR_ATTEMPTS_PER_ASK internal generations. Burn
    // refusals until the bare rung is armed, then land clean bare.
    // External rejects happen when a full in-ask ladder still cannot land.
    let externalRefuses = 0;
    while (externalRefuses < 3) {
      scripted = ['It\'t not landing, take after takeL', 'stop'];
      try {
        await ceremony.askNextQuestion(neumaId, recordId);
        break;
      } catch (e) {
        expect(e.code).toBe('ANSWER_CORRUPT');
        externalRefuses += 1;
      }
    }
    expect(externalRefuses).toBeGreaterThan(0);
    // refusals accumulate across asks — after enough, bare is armed
    const before = answerBodies.length;
    scripted = [fresh(60), 'stop'];
    const { turn } = await ceremony.askNextQuestion(neumaId, recordId);
    expect(turn.answer).toBe(fresh(60));

    // the landed attempt rode BARE (or at least no replay of the marker answer)
    // once BARE_ASK_REFUSALS was reached in the prior ladder climb
    const bare = answerBodies[before];
    const texts = bare.messages.map((m) => m.content).join('\n');
    // If the prior ladder reached bare, the fresh(50) marker is absent.
    // With DOOR_ATTEMPTS_PER_ASK * externalRefuses >= BARE_ASK_REFUSALS, it must.
    expect(externalRefuses * DOOR_ATTEMPTS_PER_ASK).toBeGreaterThanOrEqual(BARE_ASK_REFUSALS);
    expect(texts.includes(fresh(50).slice(0, 60))).toBe(false);
  }, 60_000);

  it('after the sweep the re-asked questions land fresh and the review comes back clean', async () => {
    // three questions re-entered the unanswered set — answer them fresh
    for (let i = 0; i < 3; i++) {
      scripted = [fresh(40 + i), 'stop'];
      await ceremony.askNextQuestion(neumaId, recordId);
    }
    const review = await ceremony.reviewAttunementRecord(neumaId, recordId);
    expect(review.flagged).toEqual([]);
  }, 60_000);
});
