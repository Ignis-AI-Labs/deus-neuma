/**
 * THE COMPANY LINE on the desk (RULE 0, nothing faked): the window rendered
 * for real (react-dom/server) over a board built by the REAL backend view
 * from a REAL folded line, the charter's dial the same way, the dial's
 * frontend twin pinned to the backend's, and the WAITING ON YOU row's label
 * and landing.
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { foldLine } from '../../backend/services/company-line/line-state.js';
import { lineView } from '../../backend/services/company-line/company-view.js';
import { STOPS, DEFAULT_STOP as BACK_DEFAULT, stopSays, FLOOR } from '../../backend/services/company-line/involvement-dial.js';
import { DIAL_STOPS, DEFAULT_STOP, dialSays } from '../../frontend/app/RelinkShell/house-clock/involvement-words.js';
import { CompanyLineBody } from '../../frontend/app/RelinkShell/company-line/CompanyLineBody.jsx';
import { upWords, stepWords, operatorMove, lineOverview, holderName, openHands, domainOf, handOnReady, handOnPayload, currentStage as currentStageOf } from '../../frontend/app/RelinkShell/company-line/company-line-view.js';
import { CharterSection } from '../../frontend/app/RelinkShell/house-clock/CharterSection.jsx';
import { draftFromCharter, charterFromDraft, charterLines } from '../../frontend/app/RelinkShell/house-clock/house-clock-view.js';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';
import { KIND_LABEL, cardSelector } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';

const HOLDERS = { Speculator: 'spec', Numerarius: 'numer', Architectus: 'arch', Rector: 'operator', Mercator: 'merc', Praetor: 'prae' };
const NAMES = { spec: 'Keir', numer: 'Galen', arch: 'Signal', merc: 'Sol', prae: 'Vale' };
const T = (n) => `2026-10-29T11:${String(n).padStart(2, '0')}:00.000Z`;
const COMPANY = { id: 'c-abc123-0a0b0c', name: 'Tidewater', mode: 'field', openedBy: 'operator', openedAt: T(0) };
const hand = (stage, by, inspections, n) => ({ type: 'handed', stage, by, artifact: `line/${stage}.md`, note: null, inspections, at: T(n) });
const ok = (stage, step, by, n) => ({ type: 'inspected', stage, step, verdict: 'accept', by, as: by, flaw: null, at: T(n) });
const toChoose = [
  hand('survey', 'spec', ['Numerarius'], 1), ok('survey', 0, 'numer', 2),
  hand('measure', 'numer', ['Architectus'], 3), ok('measure', 0, 'arch', 4),
  hand('shape', 'arch', ['Rector'], 5), ok('shape', 0, 'operator', 6),
  { ...hand('choose', 'operator', ['operator'], 7), artifact: 'tide tables for small harbours' },
];
const boardOf = (events) => ({
  dial: { stop: 'PARTNER', says: stopSays('PARTNER'), floor: FLOOR },
  holders: HOLDERS,
  companies: [lineView(COMPANY, foldLine(events), HOLDERS)],
});
const render = (board) => renderToStaticMarkup(createElement(CompanyLineBody, {
  board, names: NAMES, error: null, loading: false, busy: false, drafts: {}, onDraft: () => {}, onRefresh: () => {},
  onOpen: () => {}, onHandOn: () => {}, onInspect: () => {}, onCharter: () => {},
}));

describe('the dial\'s frontend twin', () => {
  test('is the backend\'s, stop for stop and word for word', () => {
    expect(DIAL_STOPS.map((s) => s.stop)).toEqual(STOPS);
    for (const { stop, says } of DIAL_STOPS) expect(says).toBe(stopSays(stop));
    expect(DEFAULT_STOP).toBe(BACK_DEFAULT);
    expect(dialSays('BEACH')).toBe(stopSays('PARTNER'));
  });
});

describe('the COMPANY LINE window', () => {
  test('a line waiting on the operator\'s inspection: the move first, with END THE GAP where the stage allows it', () => {
    const board = boardOf(toChoose);
    const [company] = board.companies;
    expect(operatorMove(company)).toEqual({ kind: 'inspect', counsel: false, stoppable: true });
    expect(upWords(company, NAMES)).toBe('YOU — TO INSPECT AS OPERATOR');
    expect(stepWords(company)).toBe('INSPECTION 1 OF 1: [OPERATOR]');
    expect(lineOverview(board)).toEqual({ owed: 1, founding: 1, standing: 0 });
    const html = render(board);
    expect(html).toContain('Tidewater · CHOOSE — YOUR INSPECTION');
    expect(html).toContain('THE WORK: tide tables for small harbours');
    expect(html).toContain('>ACCEPT<');
    expect(html).toContain('>END THE GAP<');
    expect(html).toContain(`data-company-line="${COMPANY.id}"`);
    expect(html).toContain('YOUR DIAL — PARTNER');
    // The rail names each stage's master in this house: the Speculator's stage is Keir's.
    expect(html).toContain('SURVEY</span><span class="cline-stage-m label-data">BASUNORR');
  });

  test('a line waiting on a being: no move of the operator\'s, and the rail says whose turn it is', () => {
    const board = boardOf(toChoose.slice(0, 1));
    const [company] = board.companies;
    expect(operatorMove(company)).toBeNull();
    expect(upWords(company, NAMES)).toBe('GALEN — TO INSPECT AS NUMERARIUS');
    const html = render(board);
    expect(html).toContain('NOTHING ON THE LINE WAITS ON YOU');
    expect(html).not.toContain('>ACCEPT<');
  });

  test('a stage the operator masters asks where the work lies before it can be handed on', () => {
    const html = render(boardOf(toChoose.slice(0, 6)));
    // the Rector-operator's CHOOSE: the hand-on is their yes, END THE GAP their no — one screen, no second look
    expect(html).toContain('Tidewater · CHOOSE — YOUR YES OR NO');
    expect(html).toContain('Handing it on is your yes — nothing comes back to you for a second look. Or end the gap here, and say why.');
    expect(html).toMatch(/<button type="button" class="sec-scan label-data" disabled="">HAND ON<\/button>/);
    expect(html).toMatch(/<button type="button" class="sec-scan cline-danger label-data" disabled="">END THE GAP<\/button>/);
    const [view] = boardOf(toChoose.slice(0, 6)).companies;
    const plain = render({ ...boardOf(toChoose.slice(0, 6)), companies: [{ ...view, ownYes: false }] });
    expect(html).not.toContain('A note for the inspector'); // no inspector follows the operator's own yes
    expect(plain).toContain('Tidewater · CHOOSE — YOURS TO DO');
    expect(plain).toContain('A note for the inspector');
    expect(plain).not.toContain('END THE GAP');
    expect(holderName('operator', NAMES)).toBe('YOU');
    expect(holderName(null, NAMES)).toBe('NOBODY');
  });
});

describe('the dial in the charter', () => {
  test('the form carries the stop through a save, and the approval view says what it means', () => {
    const charter = normalizeCharter({ goal: 'Found a company.', seats: [{ laneId: 'spec', dailyCap: 3 }], involvement: 'SILENT' });
    const draft = draftFromCharter(charter, [{ neumaId: 'spec' }]);
    expect(draft.involvement).toBe('SILENT');
    expect(normalizeCharter(charterFromDraft(draft)).involvement).toBe('SILENT');
    expect(draftFromCharter(null, []).involvement).toBe('PARTNER');
    expect(charterLines(charter, {})).toContainEqual({ label: 'YOUR INVOLVEMENT', value: `SILENT — ${stopSays('SILENT')}` });
  });

  test('the form shows four stops with the chosen one lit', () => {
    const charter = normalizeCharter({ goal: 'Found a company.', seats: [{ laneId: 'spec', dailyCap: 3 }], involvement: 'KIN' });
    const html = renderToStaticMarkup(createElement(CharterSection, {
      charter: { ...charter, version: 1 }, draft: draftFromCharter(charter, [{ neumaId: 'spec' }]), editing: true,
      names: { spec: 'Keir' }, optio: null, busy: false, onDraft: () => {}, onSeat: () => {}, onSave: () => {}, onApprove: () => {}, onEdit: () => {}, onCancel: () => {},
    }));
    expect(html).toContain('YOUR INVOLVEMENT — THE DIAL');
    expect(html).toContain('aria-checked="true" class="hclock-btn label-data is-primary">KIN</button>');
    expect((html.match(/role="radio"/g) || []).length).toBe(4);
  });
});

describe('WAITING ON YOU', () => {
  test('a line row is named and lands on its company', () => {
    const item = { kind: 'company-line', where: { app: 'companyline', companyId: COMPANY.id } };
    expect(KIND_LABEL[item.kind]).toBe('COMPANY LINE');
    expect(cardSelector(item)).toBe(`[data-company-line="${COMPANY.id}"]`);
  });
});

describe('YOUR HANDS on the desk', () => {
  const item = {
    id: 'h-0a1b2c3d', what: 'File the LLC in Wyoming', why: 'The company must exist before a bank account can be opened.',
    where: 'https://wyobiz.wyo.gov/Business/FilingSearch.aspx', answer: 'fact', unblocks: 'form', cost: '$100, ~20 minutes', by: '2026-11-15',
    raisedBy: 'prae', raisedAt: T(9), status: 'open', answeredAt: null, text: null,
  };
  const board = () => {
    const b = boardOf(toChoose.slice(0, 1));
    return { ...b, companies: [lineView(COMPANY, foldLine(toChoose.slice(0, 1)), HOLDERS, [item])] };
  };

  test('an ask shows what, why, the estimate, the deadline, and the site its link leads to — DONE waits for the fact', () => {
    expect(openHands(board()).map((i) => i.id)).toEqual(['h-0a1b2c3d']);
    expect(lineOverview(board())).toEqual({ owed: 1, founding: 1, standing: 0 });
    expect(domainOf(item.where)).toBe('WYOBIZ.WYO.GOV');
    expect(domainOf('not a url')).toBe('—');
    const html = render(board());
    expect(html).toContain(`data-hands-id="${item.id}"`);
    expect(html).toContain('Tidewater — ONLY YOU CAN DO THIS · ASKED BY VALE');
    expect(html).toContain('HOLDS FORM · ESTIMATE: $100, ~20 minutes · BY 2026-11-15');
    expect(html).toContain('DO IT AT WYOBIZ.WYO.GOV — <a class="cline-link" href="https://wyobiz.wyo.gov/Business/FilingSearch.aspx" target="_blank" rel="noopener noreferrer">');
    expect(html).toMatch(/disabled="">DONE<\/button>/);
    expect(html).toContain('NEVER TYPE A SECRET HERE');
  });

  test('a HANDS row is named and lands on its ask', () => {
    const row = { kind: 'hands', where: { app: 'companyline', companyId: COMPANY.id, handsId: item.id } };
    expect(KIND_LABEL[row.kind]).toBe('YOUR HANDS');
    expect(cardSelector(row)).toBe(`[data-hands-id="${item.id}"]`);
  });
});

describe('worksheets on the desk', () => {
  test('CHOOSE, when the operator masters it: the shaped gap shown, and the draft becomes the worksheet', async () => {
    const { SHEETS, GAP } = await import('../helpers/company-line-kit.js');
    const view = lineView(COMPANY, foldLine(toChoose.slice(0, 6)), HOLDERS, [], { shape: SHEETS.shape });
    const choose = view.stages.find((s) => s.id === 'choose');
    expect(choose.worksheet).toBe(true);
    expect(view.stages.find((s) => s.id === 'charter').worksheet).toBe(false);
    expect(handOnReady(choose, { why: 'ours', kill: '' })).toBe(false);
    expect(handOnReady(choose, { why: 'ours', kill: 'we stop if nobody signs\n' })).toBe(true);
    expect(handOnPayload(view, { why: 'The canvas leaves room.', kill: 'we stop if nobody signs\n\n we stop if churn > 50% ' })).toEqual({
      stage: 'choose', worksheet: { candidate: GAP, why: 'The canvas leaves room.', killCriteria: ['we stop if nobody signs', 'we stop if churn > 50%'] },
    });
    const html = render({ ...boardOf(toChoose.slice(0, 6)), companies: [view] });
    expect(html).toContain(`THE GAP SHAPED: ${GAP}`);
    expect(html).toContain('data-worksheet="shape"');
    expect(html).toContain('“Your harbour, your tides, one page.”');
  });

  test('a worksheet stage the operator writes by hand refuses JSON that does not parse', () => {
    const view = lineView(COMPANY, foldLine([]), { ...HOLDERS, Speculator: 'operator' });
    expect(handOnReady(currentStageOf(view), { json: '' })).toBe(false);
    expect(() => handOnPayload(view, { json: '{candidates:' })).toThrow('The worksheet is not valid JSON.');
  });

  test('an inspection shows the canvas: a level per factor and player, and every level\'s source', async () => {
    const { SHEETS } = await import('../helpers/company-line-kit.js');
    const events = [hand('survey', 'spec', ['Numerarius'], 1), ok('survey', 0, 'numer', 2), hand('measure', 'numer', ['Rector'], 3)];
    const view = lineView(COMPANY, foldLine(events), { ...HOLDERS, Architectus: 'operator' }, [], { survey: SHEETS.survey, measure: SHEETS.measure });
    const html = render({ ...boardOf(events), companies: [view] });
    expect(html).toContain('data-worksheet="measure"');
    expect(html).toContain('CANVAS — Tide tables for small harbours');
    expect(html).toContain('<td class="label-data" title="repos/tidewater/model-check.md">9</td>');
    expect(html).toContain('Local accuracy · National almanac · 4 — <span>interview: harbour master, Port Isaac, 2026-10-20</span>');
  });
});

describe('SALES on the desk', () => {
  test('the seat by name, the pipeline per stage with its value, each open deal with its next step', () => {
    const sales = {
      mercator: { laneId: 'merc' },
      pipeline: { qualified: { count: 1, value: { USD: 120 } }, proposed: { count: 0, value: {} }, won: { count: 2, value: { USD: 300, ETH: 0.1 } }, lost: { count: 1, value: { USD: 40 } } },
      deals: [{ id: 'd-0a0b0c0d', buyer: 'Padstow harbour office', stage: 'qualified', value: { amount: 120, currency: 'USD' }, nextStep: 'Send the sample sheet' }],
    };
    const html = renderToStaticMarkup(createElement(CompanyLineBody, {
      board: boardOf([]), names: { ...NAMES, merc: 'Sol' }, error: null, loading: false, busy: false, drafts: {}, onDraft: () => {}, onRefresh: () => {},
      onOpen: () => {}, onHandOn: () => {}, onInspect: () => {}, onAnswer: () => {}, onCharter: () => {},
      sales, onSales: { pick: '', onPick: () => {}, onSeat: () => {}, onClear: () => {} },
    }));
    expect(html).toContain('SALES — MERCATOR · SOL');
    expect(html).toContain('WON · 300 USD + 0.1 ETH');
    expect(html).toContain('data-deal-id="d-0a0b0c0d"');
    expect(html).toContain('Padstow harbour office — QUALIFIED, 120 USD — NEXT: Send the sample sheet');
    expect(html).toContain('>UNSEAT<');
  });
});

describe('THE BOOKS on the desk', () => {
  test('the keeper by name, each company to date per currency, the unmatched, a CPA\'s deadline, the unbooked receipts', () => {
    const books = {
      logista: { laneId: 'logi' }, year: '2026',
      books: [{
        id: COMPANY.id, name: 'Tidewater', voided: 1,
        yearToDate: { currencies: { USDC: { in: 120, out: 0, net: 120 } }, entries: 2, unmatched: 1 },
        deadlines: [{ id: 't-0a0b0c0d', what: 'Federal return (Form 1065)', due: '2027-03-15', authority: 'the IRS', needsCpa: true, met: null }],
      }],
      unbooked: [{ kind: 'spend', ref: 'quae:aa11', label: '0.01 ETH out by quae' }],
    };
    const html = renderToStaticMarkup(createElement(CompanyLineBody, {
      board: boardOf([]), names: { ...NAMES, logi: 'Ledger' }, error: null, loading: false, busy: false, drafts: {}, onDraft: () => {}, onRefresh: () => {},
      onOpen: () => {}, onHandOn: () => {}, onInspect: () => {}, onAnswer: () => {}, onCharter: () => {},
      books, onBooks: { pick: '', onPick: () => {}, onSeat: () => {}, onClear: () => {} },
    }));
    expect(html).toContain('THE BOOKS — LOGISTA · LEDGER');
    expect(html).toContain('USDC NET · IN 120 · OUT 0');
    expect(html).toContain('2 ENTRIES · 1 UNMATCHED · 1 VOIDED');
    expect(html).toContain('DUE 2027-03-15: Federal return (Form 1065) — TO the IRS — NEEDS A LICENSED CPA');
    expect(html).toContain('1 RECEIPT NOT YET BOOKED');
  });
});

describe('THE RAISE ROOM on the desk', () => {
  test('a draft to sign — dark until the account is entered and counsel\'s route confirmed; the facts waiting for counsel', async () => {
    const { signReady, accountFromDraft, mandateWords, accountWords } = await import('../../frontend/app/RelinkShell/company-line/raise-view.js');
    const draft = {
      id: 'm-0a0b0c0d', amount: 250000, currency: 'USD', instrument: 'safe', valuation: { low: 2000000, high: 3000000, basis: 'three comparables' },
      useOfFunds: 'Twelve months of serving', route: { kind: '506c', jurisdiction: 'US' }, limits: { perDay: 10, followUps: 2 }, minCheck: 5000,
    };
    const sheet = { id: 'f-0a0b0c0d', facts: [{ n: 1, claim: 'Three harbours pay', figure: { value: 3, unit: 'harbours' }, source: 'books: Tidewater', forwardLooking: false }] };
    const raises = [{ id: COMPANY.id, name: 'Tidewater', raise: { status: 'none', draft, mandate: null, account: null, sheet, review: null } }];
    expect(signReady({ kind: 'wallet', address: `0x${'ab'.repeat(20)}` })).toBe(false);
    expect(signReady({ kind: 'wallet', address: `0x${'ab'.repeat(20)}`, counsel: true })).toBe(true);
    expect(accountFromDraft({ kind: 'portal', portal: 'Wefunder', url: ' https://wefunder.com/x ' })).toEqual({ kind: 'portal', portal: 'Wefunder', url: 'https://wefunder.com/x' });
    expect(mandateWords(draft)).toBe('250,000 USD BY SAFE · VALUATION 2,000,000–3,000,000 · 506C IN US · 10 A DAY, 2 FOLLOW-UPS · MIN CHECK 5,000');
    expect(accountWords({ kind: 'bank', bankName: 'Mercury', accountName: 'Tidewater LLC' })).toBe('BANK Mercury — Tidewater LLC');
    const html = renderToStaticMarkup(createElement(CompanyLineBody, {
      board: boardOf([]), names: NAMES, error: null, loading: false, busy: false, drafts: {}, onDraft: () => {}, onRefresh: () => {},
      onOpen: () => {}, onHandOn: () => {}, onInspect: () => {}, onAnswer: () => {}, onCharter: () => {},
      raises, onRaise: { onSign: () => {}, onMove: () => {}, onReview: () => {} },
    }));
    expect(html).toContain(`data-raise="${COMPANY.id}"`);
    expect(html).toContain('SIGN THE MANDATE — ONLY YOU CAN');
    expect(html).toMatch(/disabled="">SIGN<\/button>/);
    expect(html).toContain('COUNSEL CHOSE THIS ROUTE');
    expect(html).toContain('FACTS SHEET — 1 FACTS · WAITING FOR COUNSEL');
    expect(html).toContain('>COUNSEL APPROVED<');
    expect(html).toContain('BEFORE ANY INVESTOR IS ASKED, COUNSEL ANSWERS');
  });

  test('a RAISE row is named and lands on its company\'s raise', () => {
    const row = { kind: 'raise', where: { app: 'companyline', companyId: COMPANY.id, raise: 'sign' } };
    expect(KIND_LABEL[row.kind]).toBe('RAISE');
    expect(cardSelector(row)).toBe(`[data-raise="${COMPANY.id}"]`);
  });
});

describe('the raise\'s investors on the desk', () => {
  test('each investor where they stand, each thread as written — the placeholder, never the account', async () => {
    const { RaiseSection } = await import('../../frontend/app/RelinkShell/company-line/RaiseSection.jsx');
    const m = { id: 'm-0a0b0c0d', amount: 250000, currency: 'USD', instrument: 'safe', valuation: { low: 2, high: 3, basis: 'b' }, useOfFunds: 'u', route: { kind: '506c', jurisdiction: 'US' }, limits: { perDay: 3, followUps: 1 }, minCheck: 5000 };
    const raises = [{ id: COMPANY.id, name: 'Tidewater', raise: {
      status: 'active', draft: m, mandate: m, account: { kind: 'wallet', address: '0x7e7e', network: 'ethereum' }, sheet: null, review: null,
      investors: [
        { id: 'i-1', name: 'Ann Fund', firm: null, status: 'declined', note: 'Not this year', thread: [{ at: '2026-11-10T09:00:00.000Z', subject: 'Tidewater', text: 'Three harbours pay. {{payment}}' }] },
        { id: 'i-2', name: 'Bo Angel', firm: 'Bo & Co', status: 'refused', note: 'Not accredited', thread: [] },
      ],
    } }];
    const html = renderToStaticMarkup(createElement(RaiseSection, { raises, drafts: {}, busy: false, onDraft: () => {}, onSign: () => {}, onMove: () => {}, onReview: () => {} }));
    expect(html).toContain('INVESTORS — 2');
    expect(html).toContain('Ann Fund — DECLINED: Not this year');
    expect(html).toContain('1 MESSAGE SENT');
    expect(html).toContain('2026-11-10 09:00 — Tidewater: Three harbours pay. {{payment}}');
    expect(html).toContain('Bo Angel (Bo &amp; Co) — REFUSED: Not accredited');
    expect(html).toContain('MONEY LANDS AT: <span class="cline-exact">WALLET 0x7e7e (ethereum)</span>');
    expect(html).toContain('>END THE RAISE</button>');
  });
});

describe('the close on the desk', () => {
  test('dark until the papers, accreditation (506c) and the receipt are there; a closed investor shows the money in', async () => {
    const { RaiseSection } = await import('../../frontend/app/RelinkShell/company-line/RaiseSection.jsx');
    const m = { id: 'm-1', amount: 100000, currency: 'USD', instrument: 'safe', valuation: { low: 2, high: 3, basis: 'b' }, useOfFunds: 'u', route: { kind: '506c', jurisdiction: 'US' }, limits: { perDay: 3, followUps: 1 }, minCheck: 5000 };
    const raise = (drafts) => renderToStaticMarkup(createElement(RaiseSection, {
      raises: [{ id: COMPANY.id, name: 'Tidewater', raise: { status: 'active', draft: m, mandate: m, account: { kind: 'wallet', address: '0x7e', network: 'ethereum' }, sheet: null, review: null, investors: [
        { id: 'i-c', name: 'Cy Ventures', status: 'sound', terms: { amount: 50000, valuation: 2500000 }, thread: [] },
        { id: 'i-d', name: 'Dee Capital', status: 'closed', closed: { amount: 20000, received: { kind: 'money-in', ref: 'ethereum:0xd:0' } }, thread: [] },
      ] } }],
      drafts, busy: false, onDraft: () => {}, onSign: () => {}, onMove: () => {}, onReview: () => {}, onClose: () => {},
    }));
    expect(raise({})).toContain('CLOSE Cy Ventures — 50,000 USD AT A 2,500,000 VALUATION — ONLY YOU SIGN');
    expect(raise({})).toContain('THE INVESTOR IS VERIFIED ACCREDITED');
    expect(raise({})).toMatch(/disabled="">SIGN THE CLOSE<\/button>/);
    expect(raise({ 'close:i-c': { papers: true, accredited: true, receipt: 'ethereum:0xabc:0' } })).toMatch(/class="sec-scan label-data">SIGN THE CLOSE<\/button>/);
    expect(raise({})).toContain('Dee Capital — CLOSED — 20,000 IN, UNDER ethereum:0xd:0');
  });
});
