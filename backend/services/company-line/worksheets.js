// THE GAP WORKSHEETS — what stages 1–5 of the founding line hand on, judged
// (docs/planning/proposals/governance/house-company-line.md §6). Blue Ocean
// Strategy's tools as structured work: SURVEY's candidates (the six paths, the
// noncustomer tiers), MEASURE's strategy canvases, SHAPE's ERRC grid and
// offer, CHOOSE's gap and kill criteria, PROVE's real-buyer results.
//
// Two laws ride every check:
//   - SHINKEI (true measure): every claim, every canvas level, every pain
//     point and every buyer result names its SOURCE — an https link, a path
//     on the house ground (repos/…), or a kind of first-hand evidence
//     ('interview: …', 'email: …'). A canvas drawn from guesses is a mock.
//   - Fitted to this blade: each stage builds on the round's earlier work —
//     MEASURE scores only SURVEY's candidates, SHAPE shapes a measured one,
//     CHOOSE and PROVE name the shaped gap. A generic worksheet cannot pass.
// Every problem is reported at once, in words a being can act on.
// PURE.

import { sourceLaw } from './source-law.js';

export const SIX_PATHS = Object.freeze(['industries', 'groups', 'buyers', 'complements', 'appeal', 'time']);
export const NONCUSTOMER_TIERS = Object.freeze(['soon', 'refusing', 'unexplored']);
export const BUYER_STAGES = Object.freeze(['purchase', 'delivery', 'use', 'supplements', 'maintenance', 'disposal']);
export const RESULT_KINDS = Object.freeze(['interview', 'test-page', 'reply', 'signup', 'preorder', 'payment']);
export const WORKSHEET_MAX_BYTES = 64 * 1024;

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v : []);
const { isSource, words: SOURCE_WORDS } = sourceLaw(['interview', 'email', 'call', 'survey', 'observation', 'dataset', 'document']);

// pure — a problem collector: need(cond, at, words) records words when cond fails.
const collector = () => {
  const problems = [];
  return { need: (ok, at, words) => { if (!ok) problems.push(`${at}: ${words}`); }, problems };
};

const survey = (w, _ctx, { need }) => {
  const c = list(w.candidates);
  need(c.length >= 1 && c.length <= 10, 'candidates', 'list 1 to 10 gap candidates');
  const names = c.map((x) => text(x?.name).toLowerCase());
  need(new Set(names).size === names.length, 'candidates', 'each candidate has its own name');
  c.forEach((x, i) => {
    const at = `candidates[${i}]`;
    need(text(x?.name).length >= 3, `${at}.name`, 'name the candidate');
    need(text(x?.gap).length >= 20, `${at}.gap`, 'say the gap: who is unserved, and how');
    need(SIX_PATHS.includes(x?.path), `${at}.path`, `which of the six paths found it: ${SIX_PATHS.join(', ')}`);
    need(x?.noncustomers == null || NONCUSTOMER_TIERS.includes(x.noncustomers), `${at}.noncustomers`, `one of ${NONCUSTOMER_TIERS.join(', ')}, or leave it out`);
    need(list(x?.evidence).length >= 1, `${at}.evidence`, 'at least one claim with its source');
    list(x?.evidence).forEach((e, j) => {
      need(text(e?.claim).length >= 10, `${at}.evidence[${j}].claim`, 'state the claim');
      need(isSource(e?.source), `${at}.evidence[${j}].source`, SOURCE_WORDS);
    });
  });
};

const measure = (w, ctx, { need }) => {
  const known = list(ctx.survey?.candidates).map((x) => text(x?.name).toLowerCase());
  const canvases = list(w.canvases);
  need(canvases.length >= 1, 'canvases', 'draw at least one strategy canvas');
  canvases.forEach((cv, i) => {
    const at = `canvases[${i}]`;
    need(known.includes(text(cv?.candidate).toLowerCase()), `${at}.candidate`, `a candidate SURVEY handed on (${known.join(', ') || 'none yet'})`);
    const players = list(cv?.players).map(text).filter(Boolean);
    need(players.length >= 2 && new Set(players).size === players.length, `${at}.players`, 'at least two players, each named once — the field, and the offer that would serve this gap');
    const factors = list(cv?.factors);
    need(factors.length >= 3, `${at}.factors`, 'at least three factors the field competes on');
    factors.forEach((f, j) => {
      const fat = `${at}.factors[${j}]`;
      need(text(f?.name).length >= 2, `${fat}.name`, 'name the factor');
      const levels = list(f?.levels);
      players.forEach((p) => {
        const hits = levels.filter((l) => text(l?.player) === p);
        need(hits.length === 1, `${fat}`, `exactly one level for "${p}"`);
        const l = hits[0];
        if (!l) return;
        need(Number.isInteger(l.level) && l.level >= 0 && l.level <= 10, `${fat}.${p}.level`, 'a whole number from 0 to 10');
        need(isSource(l.source), `${fat}.${p}.source`, SOURCE_WORDS);
      });
    });
    need(text(cv?.reading).length >= 20, `${at}.reading`, 'read the canvas: where the field converges (red), where it leaves room (blue)');
  });
};

const shape = (w, ctx, { need }) => {
  const measured = list(ctx.measure?.canvases).map((c) => text(c?.candidate).toLowerCase());
  need(measured.includes(text(w.candidate).toLowerCase()), 'candidate', `a candidate MEASURE drew (${measured.join(', ') || 'none yet'})`);
  const errc = w.errc ?? {};
  ['eliminate', 'reduce', 'raise', 'create'].forEach((k) => need(Array.isArray(errc[k]), `errc.${k}`, 'a list (it may be empty, but say so with [])'));
  need(list(errc.create).length >= 1, 'errc.create', 'create at least one thing the field has never offered');
  need(list(errc.eliminate).length + list(errc.reduce).length >= 1, 'errc', 'eliminate or reduce at least one thing — value innovation cuts cost as it adds value');
  const pains = list(w.painPoints);
  need(pains.length >= 1, 'painPoints', 'at least one buyer pain point');
  pains.forEach((p, i) => {
    need(BUYER_STAGES.includes(p?.stage), `painPoints[${i}].stage`, `where in the buyer's cycle: ${BUYER_STAGES.join(', ')}`);
    need(text(p?.pain).length >= 10, `painPoints[${i}].pain`, 'say the pain');
    need(isSource(p?.source), `painPoints[${i}].source`, SOURCE_WORDS);
  });
  need(text(w.forWhom).length >= 10, 'forWhom', 'name the buyer this is for, specifically');
  need(text(w.offer).length >= 40, 'offer', 'describe the offer in at least a sentence or two');
  const band = w.priceBand ?? {};
  need(Number.isFinite(band.low) && Number.isFinite(band.high) && band.low >= 0 && band.high >= band.low, 'priceBand', '{low, high} numbers, high at least low');
  need(/^[A-Z]{3}$/.test(text(band.currency)), 'priceBand.currency', 'a three-letter currency (USD, ETH, …)');
  need(text(band.basis).length >= 10, 'priceBand.basis', 'what the band is set against (the price corridor of the mass)');
  need(text(w.tagline).length >= 3 && text(w.tagline).length <= 90, 'tagline', 'one line, at most 90 characters');
};

const choose = (w, ctx, { need }) => {
  need(text(w.candidate).toLowerCase() === text(ctx.shape?.candidate).toLowerCase(), 'candidate', `the gap SHAPE shaped (${text(ctx.shape?.candidate) || 'none yet'})`);
  need(text(w.why).length >= 40, 'why', 'why this gap is ours, in a sentence or two');
  const kill = list(w.killCriteria);
  need(kill.length >= 1, 'killCriteria', 'at least one "we stop if …"');
  kill.forEach((k, i) => need(text(k).length >= 10, `killCriteria[${i}]`, 'a concrete condition'));
};

const prove = (w, ctx, { need }) => {
  need(text(w.candidate).toLowerCase() === text(ctx.choose?.candidate).toLowerCase(), 'candidate', `the gap CHOOSE chose (${text(ctx.choose?.candidate) || 'none yet'})`);
  const results = list(w.results);
  need(results.length >= 3, 'results', 'at least three real responses from buyers');
  results.forEach((r, i) => {
    const at = `results[${i}]`;
    need(RESULT_KINDS.includes(r?.kind), `${at}.kind`, `one of ${RESULT_KINDS.join(', ')}`);
    need(text(r?.who).length >= 3, `${at}.who`, 'who answered (a person, a company, a page)');
    need(!Number.isNaN(Date.parse(r?.date)), `${at}.date`, 'when (a date)');
    need(text(r?.outcome).length >= 10, `${at}.outcome`, 'what they did or said');
    need(isSource(r?.source), `${at}.source`, SOURCE_WORDS);
  });
  need(typeof w.standIns === 'boolean', 'standIns', 'true when any response is a named stand-in (a simulated economy), false when every one is real');
  need(text(w.summary).length >= 40, 'summary', 'what the responses say, against the kill criteria');
};

const CHECKS = Object.freeze({ survey, measure, shape, choose, prove });

/** Does this stage hand on a worksheet? pure. */
export const takesWorksheet = (stageId) => Object.hasOwn(CHECKS, stageId);

/**
 * Judge one worksheet against its stage and the round's earlier work. pure.
 * @param {string} stageId
 * @param {unknown} worksheet
 * @param {Record<string, object>} context - the round's accepted worksheets, by stage id
 * @returns {{ok: true} | {ok: false, problems: string[]}}
 */
export const checkWorksheet = (stageId, worksheet, context) => {
  if (!takesWorksheet(stageId)) return { ok: true };
  if (!worksheet || typeof worksheet !== 'object' || Array.isArray(worksheet)) {
    return { ok: false, problems: ['worksheet: this stage hands on a worksheet object'] };
  }
  if (Buffer.byteLength(JSON.stringify(worksheet), 'utf8') > WORKSHEET_MAX_BYTES) {
    return { ok: false, problems: [`worksheet: at most ${WORKSHEET_MAX_BYTES / 1024} KB — put long research on the house ground and cite it as repos/…`] };
  }
  const c = collector();
  CHECKS[stageId](worksheet, context ?? {}, c);
  return c.problems.length ? { ok: false, problems: c.problems } : { ok: true };
};
