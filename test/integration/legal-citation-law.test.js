/**
 * THE CITATION LAW, end to end with no mock on the claimed path (RULE 0):
 * a REAL seated CLO, REAL intents filed into the lane and settled by the REAL
 * sweep, the REAL matters ledger and opinions drawer on temp disk, and the
 * platform's check re-reading the REAL sources over the real web.
 *
 * Built from a 2026-10-31 citation audit of a legal office's answer: one
 * quotation its source never printed, a statute paraphrased inside quotation
 * marks, provisions cited by the wrong section, "[verify]" shipped, and an
 * order six weeks old nobody looked for. Each of those must now be refused
 * before the operator ever reads it — at the door when the draft shows it, at
 * execute when only the source (or the regulators' feeds) can.
 *
 * The second reader is a model: the suite never touches the GPU, so here the
 * house's reader is a provider that is no longer connected, and a filing that
 * passes the check and the sweep must stop at it — FAIL-CLOSED. A reader that
 * answers is proven live, on a model the operator chooses, never in the suite.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses, HOUSE_A } from '../helpers/house-office-kit.js';
import { cloDesignation } from '../../backend/services/legal/clo-designation.js';
import { matterLedgerFor } from '../../backend/services/legal/matter-ledger.js';
import { handleLegalTool } from '../../backend/services/legal/legal-being-tools.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { runRecencySweep } from '../../backend/services/legal/recency-sweep.js';
import { readReaderSetting, saveReaderSetting } from '../../backend/services/legal/second-reader.js';
import { officeFile } from '../../backend/services/house-office.js';
import { saveDoc } from '../../backend/services/legal/legal-store-io.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const CLO_LANE = 'praetorlane';
const OTHER_LANE = 'someotherlane';
const ENV_PATHS = [
  'NEUMA_DATA_ROOT', 'NEUMA_WEB_ACCESS',
  'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SECTOR_CREW_PATH',
  'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_EMAIL_CREDENTIALS_PATH',
];

const RELEASE = Object.freeze({
  claim: 'Putting a security on a chain does not change whether it is a security.',
  authority: 'SEC/CFTC Rel. No. 33-11412', pinCite: '§ III.E, p. 24', pages: '24', standing: 'adopted 2026-03-17',
  heading: 'Application of the Federal Securities Laws to Certain Types of Crypto Assets',
  sourceUrl: 'https://www.sec.gov/files/rules/interp/2026/33-11412.pdf',
  quote: 'A security is a security regardless of whether it is issued, or otherwise represented, offchain or onchain.',
});
const INVENTED = 'Digital securities are tokenized versions of financial instruments that fall within the statutory definition of \'security.\' Tokenization does not alter the analysis.';
const BROKER = Object.freeze({
  claim: 'A broker effects securities transactions for others.',
  authority: '15 U.S.C. § 78c', pinCite: '(a)(4)(A)', heading: 'Definitions and application', standing: 'in force',
  sourceUrl: 'https://www.law.cornell.edu/uscode/text/15/78c',
  quote: 'engaged in the business of effecting transactions in securities for the account of others',
});
const WRONG_SECTION = Object.freeze({
  claim: 'Dealing in investments as a business needs authorisation.', authority: 'FSMA 2000', pinCite: 's. 25',
  heading: 'Dealing in investments as a business', standing: 'in force',
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2000/8/section/25',
});
const SWEEP = Object.freeze({ terms: ['tokenized securities'], jurisdictions: ['US'] });

describe('the citation law (real seat, real sweep, real sources)', () => {
  let houses;
  const savedEnv = {};
  const connection = (neumaId) => ({ ws: null, walletAddress: HOUSE_A, companion: { name: 'LawEcho', neumaId } });
  const opinionsDir = () => path.join(workspace.pathFor(CLO_LANE), 'legal', 'opinions');
  const opinions = async () => (await fs.readdir(opinionsDir()).catch(() => [])).filter((f) => f.includes('-opinion-'));
  const file = async (name, payload) => {
    const dir = path.join(workspace.pathFor(CLO_LANE), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
    const [result] = await sweepIntents(connection(CLO_LANE), { mode: 'auto', lanePolicy: null, emit: () => {} });
    return result;
  };
  const opinion = (over) => ({
    type: 'legal/opinion', title: 'Is a tokenized stock a security', question: 'Are tokenized securities still securities?',
    answer: `Tokenized securities are still securities. The release says "${RELEASE.quote}"`,
    citations: [RELEASE], sweep: SWEEP, recency: [], ...over,
  });
  let owed = null; // what the app's own sweep finds owed an answer, learned once (the feeds move daily)

  beforeAll(async () => {
    houses = await standTwoHouses({ lanesA: [CLO_LANE, OTHER_LANE], lanesB: [], label: 'legal-citation-law' });
    for (const k of ENV_PATHS) savedEnv[k] = process.env[k];
    delete process.env.NEUMA_WEB_ACCESS;
    process.env.NEUMA_DATA_ROOT = houses.tmp; // a fresh install: web access is on until the operator turns it off
    for (const [k, f] of [['NEUMA_SOCIAL_BINDINGS_PATH', 'social-bindings'], ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'social-credentials'],
      ['NEUMA_SECTOR_CREW_PATH', 'sector-crew'], ['NEUMA_EMAIL_BINDING_PATH', 'email-binding'], ['NEUMA_EMAIL_CREDENTIALS_PATH', 'email-credentials']]) {
      process.env[k] = path.join(houses.tmp, `${f}.json`);
    }
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    // The house chose a reader that is no longer connected: no model is asked, and none may be skipped.
    await saveDoc(officeFile(HOUSE_A, 'legal', 'second-reader.json'), { provider: 'a-provider-since-removed', setAt: '2026-10-31T00:00:00.000Z', setBy: HOUSE_A });
  }, 60_000);

  afterAll(async () => {
    for (const k of ENV_PATHS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    houses.restore();
    await fs.rm(houses.tmp, { recursive: true, force: true });
  });

  test('AT THE DOOR — a [verify], an unbound quotation, no sweep, a bare string: nothing reaches a card', async () => {
    const verify = await file('verify', opinion({ answer: 'The finder line is settled. **[verify]**' }));
    expect(verify.status).toBe('error');
    expect(verify.error).toMatch(/still carries \[verify\]/);
    const unbound = await file('unbound', opinion({ answer: `The release says "${INVENTED}"` }));
    expect(unbound.error).toMatch(/quotation marks around words no citation record quotes/);
    const unswept = await file('unswept', opinion({ sweep: undefined }));
    expect(unswept.error).toMatch(/name 1 to 4 search terms for the app's recency sweep/);
    const offTopic = await file('offtopic', opinion({ sweep: { terms: ['stablecoin'], jurisdictions: ['US'] } }));
    expect(offTopic.error).toMatch(/"stablecoin" does not/);
    const string = await file('string', opinion({ citations: ['SEC Release 33-11412 (Mar. 17, 2026)'] }));
    expect(string.error).toMatch(/citation 1 is a string/);
    expect(await opinions()).toEqual([]);
  });

  test('AT EXECUTE — an invented quotation goes to the real release, is not found, and nothing is delivered', async () => {
    const result = await file('invented', opinion({ answer: `On tokenized securities the release says "${INVENTED}"`, citations: [{ ...RELEASE, quote: INVENTED }] }));
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/not delivered — the platform's citation check did not pass/);
    expect(result.error).toMatch(/QUOTE NOT IN SOURCE · SEC\/CFTC Rel\. No\. 33-11412/);
    expect(await opinions()).toEqual([]);
  }, 60_000);

  test('THE SWEEP — the app\'s own search finds what the filing never answered for; nothing is delivered', async () => {
    const swept = await runRecencySweep(SWEEP, { connection: connection(CLO_LANE) });
    owed = swept.items.filter((i) => i.owed);
    expect(owed.length).toBeGreaterThan(0); // the case is real before we assert on it
    const result = await file('unanswered', opinion({ citations: [RELEASE, BROKER], answer: `Tokenized securities are still securities: "${RELEASE.quote}" A venue is close to a broker, a person "${BROKER.quote}".` }));
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/not delivered — the app's recency sweep found actions this filing does not answer for/);
    expect(result.error).toContain(owed[0].ref.length > 40 ? owed[0].title.slice(0, 40) : owed[0].ref);
    expect(await opinions()).toEqual([]);
  }, 90_000);

  test('THE READER — checked and swept, it still waits on the second reader; a reader that cannot be had lands nothing', async () => {
    expect(owed).not.toBeNull();
    const recency = owed.map((i) => `${i.ref} — read; not on point for this question.`);
    const result = await file('reader', opinion({
      citations: [RELEASE, BROKER], recency,
      answer: `Tokenized securities are still securities: "${RELEASE.quote}" A venue is close to a broker, a person "${BROKER.quote}".`,
    }));
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/not delivered — the second reader did not pass it/);
    expect(result.error).toMatch(/the second reader \(a-provider-since-removed\) could not be had: the chosen reader a-provider-since-removed is no longer connected/);
    expect(await opinions()).toEqual([]);
  }, 90_000);

  test('THE READER\'S SEAT — the house\'s own model by default; only a connected provider may be chosen', async () => {
    expect((await saveReaderSetting(HOUSE_A, 'not-a-connected-provider')).error).toMatch(/not a connected provider/);
    expect((await saveReaderSetting(HOUSE_A, 'house')).ok).toBe(true);
    expect((await readReaderSetting(HOUSE_A)).provider).toBe('house');
    await saveDoc(officeFile(HOUSE_A, 'legal', 'second-reader.json'), { provider: 'a-provider-since-removed', setAt: null, setBy: HOUSE_A });
  });

  test('WEB OFF — a reading that rests on a source cannot land; an honest hand-off can', async () => {
    const { added: [matter] } = await (await matterLedgerFor(HOUSE_A)).ingest([{
      area: 'regulation', source: 'manual', externalId: 'law-fixture', title: 'Is the venue a broker', severity: 'high',
    }]);
    process.env.NEUMA_WEB_ACCESS = '0';
    try {
      const held = await file('held', { type: 'legal/assess', id: matter.id, status: 'concern', assessment: 'A venue for tokenized securities effects trades for others.', citations: [BROKER], sweep: SWEEP });
      expect(held.status).toBe('error');
      expect(held.error).toMatch(/Web access is OFF/);
      expect((await (await matterLedgerFor(HOUSE_A)).get(matter.id)).status).toBe('new');
      const handOff = await file('handoff', { type: 'legal/assess', id: matter.id, status: 'needs_operator', assessment: 'The broker definition could not be read: web access is off. Turn it on, or ask counsel.' });
      expect(handOff.status, handOff.error).toBe('ok');
    } finally {
      delete process.env.NEUMA_WEB_ACCESS;
    }
  });

  test('THE TOOL — the seated CLO checks a draft before it leaves; no other lane may', async () => {
    const out = await handleLegalTool(null, connection(CLO_LANE), null, 'auto', { toolName: 'legal_cite_check' }, {
      citations: [WRONG_SECTION], text: 'Dealing is regulated by section 25 [verify].',
    });
    expect(out.status, out.error).toBe('ok');
    expect(out.content).toMatch(/^DRAFT REFUSED — the draft still carries \[verify\]/);
    expect(out.content).toMatch(/HEADING NOT IN SOURCE · FSMA 2000, s\. 25/);
    const refused = await handleLegalTool(null, connection(OTHER_LANE), null, 'auto', { toolName: 'legal_cite_check' }, { citations: [WRONG_SECTION] });
    expect(refused.status).toBe('error');
    expect(refused.error).toMatch(/seated CLO/);
  }, 60_000);
});
