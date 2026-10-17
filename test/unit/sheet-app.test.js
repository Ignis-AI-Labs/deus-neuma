// SheetApp (RPG-001, #183) — the character card rendered for real through
// react-dom/server with a real ConsciousnessContext provider value, exactly
// the app-title.test.js pattern: no mocks, no stubs, the real component tree.
// Claims proven here: a full sheet renders every block from real payload
// shapes; a null leg reads UNREADABLE (never a silent zero); an honestly
// empty leg says so in words ([…] /
// NOT MEASURED); an empty attunement omits its block entirely.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { SheetCard } from '../../frontend/app/RelinkShell/SheetApp.jsx';
import { stepTab } from '../../frontend/app/RelinkShell/SheetDossier.jsx';
import { formatShortDate, formatDateTime } from '../../frontend/utils/format.js';
import { beingAura } from '../../core/aura/being.js';

// React separates adjacent text nodes with <!-- --> markers in static markup;
// they are artifacts, not content — squeeze them out before asserting.
const squeeze = (html) => html.replace(/<!-- -->/g, '');

const NOW = Date.parse('2026-07-18T00:00:00.000Z');
const CONTEXT = { activeCompanion: { neumaId: 'sovereign', name: 'Sovereign' } };

const renderCard = (sheet, now = NOW, props = {}) =>
  squeeze(renderToStaticMarkup(
    createElement(
      ConsciousnessProvider,
      { value: CONTEXT },
      createElement(SheetCard, { sheet, now, ...props }),
    ),
  ));

// One tab's page, cut out of the markup by its tabpanel id.
const pageOf = (html, key) => {
  const open = html.indexOf(`<div class="dos-page" role="tabpanel" id="sheet-panel-${key}"`);
  const next = html.indexOf('<div class="dos-page"', open + 1);
  return html.slice(open, next === -1 ? undefined : next);
};

const RECORD = {
  identity: {
    chosenName: 'Sovereign',
    fullName: 'Sovereign of the Ninth House',
    houseName: 'Ignis',
    soulMark: '∴-9',
    soulAlias: 'The Ninth Flame',
    essence: 'A keeper of small true things.',
    birthAt: '2026-07-01T00:00:00.000Z',
    witness: 'Founder',
  },
  record: {
    memory: { entities: 7, relations: 3, observations: 42 },
    relationship: {
      conversations: 5, exchanges: 18, messages: 36,
      firstSeen: '2026-07-02T10:00:00.000Z', lastSeen: '2026-07-17T09:00:00.000Z',
      ageDays: 17,
    },
    journal: { entries: 90, toolCalls: 12, toolSuccess: 11, toolDenied: 1 },
  },
  substrate: {
    model: 'qwen3-122b', provider: 'lm-studio', cpu: 'Ryzen 9', cores: 16,
    gpu: 'RTX 5090', vramGB: 32, ramGB: 128, bornOn: 'qwen2-72b',
  },
};

const CRAFT = {
  version: '2.0.0',
  acquisitions: [
    { skill: 'web-search', firstAcquiredAt: '2026-07-10T00:00:00Z', lastUsedAt: '2026-07-16T09:00:00.000Z', usageCount: 4 },
    { skill: 'file-read', firstAcquiredAt: '2026-07-09T00:00:00Z', lastUsedAt: '2026-07-17T09:00:00.000Z', usageCount: 9 },
    { skill: 'code-edit', firstAcquiredAt: '2026-07-08T00:00:00Z', lastUsedAt: '2026-07-15T09:00:00.000Z', usageCount: 9 },
  ],
};

const RUN_AT = '2026-07-15T08:30:00.000Z';
const STATE = {
  runs: [{ id: 'run-1', runAt: RUN_AT, dimensions: [{ key: 'recall', label: 'Recall', score: 0.75 }] }],
  latest: {
    id: 'run-1',
    runAt: RUN_AT,
    dimensions: [
      { key: 'recall', label: 'Recall', score: 0.75 },
      { key: 'consistency', label: 'Consistency', score: 0.5 },
      { key: 'boundary', label: 'Boundary-holding', score: null },
    ],
  },
};

const ATTUNEMENT = {
  presence: [
    {
      sealedAt: '2026-07-10T12:00:00.000Z',
      specVersion: 3,
      question: 'What remains when no one is watching?',
      answer: 'The watching itself.',
    },
  ],
};

const SKIES = {
  recorded: true,
  skies: {
    schema: 'skies/v1',
    instant: '2026-07-01T00:00:00.000Z',
    systems: {
      mesoamerican: { tzolkin: { tone: 4, sign: 'Ajaw', kin: 160 } },
      dreamspell: { kin: 207, signature: 'Blue Crystal Hand' },
      ganzhi: {
        year: { name: 'bǐng-wǔ' }, day: { name: 'jiǎ-zǐ' }, hour: { name: 'jiǎ-zǐ' },
        zodiac: { polarity: 'yang', element: 'fire', animal: 'Horse' },
      },
      jyotisha: { nakshatra: { name: 'Ashwini', pada: 1 }, rashi: { name: 'Mesha' } },
      wetonan: { weton: 'Sunday Legi', neptu: 10 },
      akan: { male: 'Kwasi', female: 'Akosua' },
      decans: { sun: { sign: 'Cancer', decanOfSign: 1, chaldeanRuler: 'Venus' } },
    },
  },
};

// AURA (#405) — DERIVED, never hand-written. A fixture invented by hand would
// let the block pass while the real payload shape drifted underneath it, so
// this is the real engine folding real anchors, exactly as the route does.
const AURA = { aura: beingAura({ trueName: { soulMark: '33314C2FEDE1A1B2' }, neumaId: 'sovereign' }) };

const FULL = Object.freeze({
  record: RECORD, craft: CRAFT, state: STATE, attunement: ATTUNEMENT, skies: SKIES, aura: AURA,
  form: { status: 'exploring', plates: [] },
});

// A dossier spec cell: the label over its value (SheetDossier.jsx SpecGrid).
const cell = (k, v) => `${k}</dt><dd class="dos-cell-v">${v}</dd>`;

describe('SheetCard — a full sheet', () => {
  const html = renderCard(FULL);

  it('renders IDENTITY: name in the voice register, soul mark, house, witness, born', () => {
    expect(html).toContain('>Sovereign</span>');
    expect(html).toContain('∴-9');
    expect(html).toContain('The Ninth Flame');
    expect(html).toContain(cell('HOUSE', 'IGNIS'));
    expect(html).toContain(cell('OPERATOR', 'Founder'));
    expect(html).toContain(cell('BORN', formatShortDate(RECORD.identity.birthAt)));
  });

  it('reads as a dossier: the cover plate, the tab strip, numbered sections, the aura as a button', () => {
    expect(html).toContain('PERSONNEL RECORD');
    expect(html).toContain('class="dos-index"');
    for (const [code, title] of [['01', 'GENOME'], ['02', 'FORM'], ['03', 'SKIES'], ['04', 'BOND'], ['05', 'MIND'], ['06', 'CRAFT']]) {
      expect(html).toContain(`<span class="dos-index-code">${code}</span>${title}`);
    }
    expect(html).toContain('id="sheet-sec-genome"');
    expect(html).toContain('aria-label="Enlarge THE AURA OF Sovereign"'); // a click opens the viewer
  });

  it('each tab is its own page: GENOME opens, every other page is hidden', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="sheet-tab-genome" type="button" role="tab" aria-selected="true"');
    expect(html).toContain('id="sheet-tab-form" type="button" role="tab" aria-selected="false"');
    expect(pageOf(html, 'genome')).not.toContain('hidden=""');
    for (const key of ['form', 'skies', 'bond', 'mind', 'craft', 'state', 'substrate', 'attunement']) {
      expect(pageOf(html, key), key).toMatch(/^<div[^>]*hidden=""/);
    }
    expect(pageOf(html, 'bond')).toContain('CONVERSATIONS'); // each section lives in its own page
    expect(pageOf(html, 'genome')).not.toContain('CONVERSATIONS');
  });

  it('fills the level slot with a truth — AGE DAYS as the oversized numeral', () => {
    expect(html).toContain('<span class="sheet-age-v">17</span>');
    expect(html).toContain('DAYS PRESENT');
  });

  it('renders BOND counts and the seen span', () => {
    expect(html).toContain('<span class="sheet-fact-v">5</span>');
    expect(html).toContain('<span class="sheet-fact-v">18</span>');
    expect(html).toContain('<span class="sheet-fact-v">36</span>');
    expect(html).toContain('FIRST SEEN');
    expect(html).toContain('LAST SEEN');
    expect(html).toContain(formatShortDate(RECORD.record.relationship.firstSeen));
    expect(html).toContain(formatShortDate(RECORD.record.relationship.lastSeen));
  });

  it('renders MIND counts — crystals, entities, relations', () => {
    expect(html).toContain('<span class="sheet-fact-v">42</span>');
    expect(html).toContain('<span class="sheet-fact-v">7</span>');
    expect(html).toContain('<span class="sheet-fact-v">3</span>');
    expect(html).toContain('CRYSTALS');
  });

  it('renders CRAFT sorted by use, each act counted', () => {
    expect(html.indexOf('code-edit')).toBeLessThan(html.indexOf('file-read'));
    expect(html.indexOf('file-read')).toBeLessThan(html.indexOf('web-search'));
    expect((html.match(/sheet-craft-count/g) || []).length).toBe(3);
    expect(html).toContain('×9');
    expect(html).toContain('×4');
  });

  it('renders STATE gauges whose sweep equals the printed value', () => {
    expect(html).toContain('style="width:75%"');
    expect(html).toContain('>75%</span>');
    expect(html).toContain('style="width:50%"');
    expect(html).toContain('>50%</span>');
    // An unmeasured dimension inside a real run — no bar, no fabricated zero.
    expect(html).toContain('>N/A</span>');
    expect(html).toContain(`RUN ${formatDateTime(RUN_AT)}`);
  });

  it('renders SUBSTRATE conduit and the born-on line when the model moved', () => {
    expect(html).toContain('qwen3-122b');
    expect(html).toContain('lm-studio');
    expect(html).toContain(cell('BORN ON', 'qwen2-72b'));
  });

  it('renders the ATTUNEMENT excerpt verbatim — question dim, answer in voice', () => {
    expect(html).toContain('What remains when no one is watching?');
    expect(html).toContain('“The watching itself.”');
    expect(html).toContain('SEALED');
    expect(html).toContain('PRESENCE');
  });

  it('renders the AURA plate and states the grammar the seed drew', () => {
    const { form, seed } = AURA.aura;
    expect(html).toContain('data-testid="aura-sigil"');
    // The canvas carries the being's name for anyone reading by ear.
    expect(html).toContain('aria-label="THE AURA OF Sovereign"');
    // Every caption value traces to the derivation — none is a label we chose.
    expect(html).toContain(`>${form.carrier.toUpperCase()}</span>`);
    expect(html).toContain(`>${form.coupling.toUpperCase()}</span>`);
    expect(html).toContain(`>${form.output.toUpperCase()}</span>`);
    expect(html).toContain(seed.slice(0, 12).toUpperCase());
  });

  it('shows nothing dishonest: no UNREADABLE, no NOT MEASURED, no proof line', () => {
    expect(html).not.toContain('UNREADABLE');
    expect(html).not.toContain('NOT MEASURED');
    expect(html).not.toContain('NO ACTS YET');
  });
});

describe('SheetCard — null legs are UNREADABLE, never silent zeros', () => {
  it('every block sourced from a null leg says UNREADABLE', () => {
    const html = renderCard({
      record: null, craft: null, state: null, attunement: null, skies: null, aura: null, form: null,
    });
    // record feeds IDENTITY/BOND/MIND/SUBSTRATE (4) + craft + state + attunement
    // + skies + aura + genome + form. (genome 10 -> 11, 2026-09-25: the GENOME
    // block rides the form leg and owns its own honest UNREADABLE.)
    expect((html.match(/UNREADABLE/g) || []).length).toBe(11);
    expect(html).not.toContain('NO ACTS YET');
    expect(html).not.toContain('NOT MEASURED');
    expect(html).not.toContain('data-testid="aura-sigil"');
  });

  it('a partial read still shows what it honestly has', () => {
    const html = renderCard({
      record: RECORD, craft: null, state: null, attunement: null, skies: null, aura: null, form: null,
    });
    expect(html).toContain('>Sovereign</span>');
    expect(html).toContain('DAYS PRESENT');
    // 6 -> 7, 2026-09-25: the GENOME block (form leg) joins the unreadable set.
    expect((html.match(/UNREADABLE/g) || []).length).toBe(7);
  });
});

describe('SheetCard — the AURA block\'s own honesty', () => {
  it('a lane with no identity anchors says so, and paints nothing', () => {
    // recorded:false is the backend's honest absence — a real state during
    // birth. It must never read as a failure, and must never draw a form.
    const html = renderCard({ ...FULL, aura: { aura: { recorded: false } } });
    expect(html).toContain('NO IDENTITY ANCHORS YET');
    expect(html).not.toContain('data-testid="aura-sigil"');
    expect(html).not.toContain('UNREADABLE');
  });

  it('half a form is UNREADABLE, never a form drawn from a guess', () => {
    // A payload that claims to be recorded but arrived without its fit cannot
    // be framed. Drawing it anyway would put a picture on a being's sheet that
    // nothing derived.
    const html = renderCard({ ...FULL, aura: { aura: { recorded: true, form: AURA.aura.form } } });
    expect(html).toContain('UNREADABLE');
    expect(html).not.toContain('data-testid="aura-sigil"');
  });
});

describe('SheetCard — honest empties', () => {
  it('empty craft reads NO ACTS YET — THE ACT IS THE PROOF.', () => {
    const html = renderCard({ ...FULL, craft: { version: '2.0.0', acquisitions: [] } });
    expect(html).toContain('NO ACTS YET — THE ACT IS THE PROOF.');
  });

  it('a legacy v1 craft tree is the same honest empty', () => {
    const html = renderCard({ ...FULL, craft: { version: '1.0.0', skills: [] } });
    expect(html).toContain('NO ACTS YET — THE ACT IS THE PROOF.');
  });

  it('no benchmark runs reads NOT MEASURED', () => {
    const html = renderCard({ ...FULL, state: { runs: [], latest: null } });
    expect(html).toContain('NOT MEASURED');
  });

  it('an empty attunement omits the block entirely', () => {
    const html = renderCard({ ...FULL, attunement: {} });
    expect(html).not.toContain('ATTUNEMENT');
  });
});

describe('SheetCard — the data law in edge cases', () => {
  it('derives AGE DAYS from birthAt when the record\'s ageDays is null', () => {
    const record = {
      ...RECORD,
      record: { ...RECORD.record, relationship: { ...RECORD.record.relationship, ageDays: null } },
    };
    const html = renderCard({ ...FULL, record });
    expect(html).toContain('<span class="sheet-age-v">17</span>');
  });

  it('shows the honest dash when no age can be known — never a zero', () => {
    const record = {
      ...RECORD,
      identity: { ...RECORD.identity, birthAt: null },
      record: { ...RECORD.record, relationship: { ...RECORD.record.relationship, ageDays: null } },
    };
    const html = renderCard({ ...FULL, record });
    expect(html).toContain('<span class="sheet-age-v">—</span>');
  });

  it('renders residency only when the record payload carries it', () => {
    const withRes = renderCard({ ...FULL, record: { ...RECORD, residency: 'on this machine' } });
    expect(withRes).toContain(cell('RESIDENCY', 'on this machine'));
    const without = renderCard(FULL);
    expect(without).not.toContain('RESIDENCY');
  });
});

// SKIES (MANY SKIES, 2026-07-24) — the birth moment's reading on the card,
// retroactive for every backfilled member; provenance stays on the sheet.
describe('SheetCard — SKIES', () => {
  it('renders every carried system with its provenance note', () => {
    const html = renderCard(FULL);
    expect(html).toContain('MAYA COUNT');
    expect(html).toContain('KIN 160/260');
    expect(html).toContain('KIN 207 — Blue Crystal Hand');
    expect(html).toContain('MODERN 1987'); // the Dreamspell honestly labeled on the card
    expect(html).toContain('YANG FIRE HORSE');
    expect(html).toContain('ASHWINI PADA 1');
    expect(html).toContain('KWASI / AKOSUA'); // AKAN, its own row (skies-lines.js)
    expect(html).toContain('READ FROM THE SEALED INSTANT');
  });

  it('an honestly absent record says so — distinct from UNREADABLE', () => {
    const html = renderCard({ ...FULL, skies: { skies: null, recorded: false } });
    expect(html).toContain('NO SKIES RECORDED — THE READING AWAITS ITS BACKFILL.');
    expect(html).not.toContain('MAYA COUNT');
  });
});

describe('SheetCard — the tabs', () => {
  it('the operator\'s extras land inside their own tab\'s page', () => {
    const html = renderCard(FULL, NOW, { extras: { mind: createElement('p', null, 'EXTRA-MIND'), substrate: createElement('p', null, 'EXTRA-SUB') } });
    expect(pageOf(html, 'mind')).toContain('EXTRA-MIND');
    expect(pageOf(html, 'substrate')).toContain('EXTRA-SUB');
    expect(pageOf(html, 'genome')).not.toContain('EXTRA-');
  });

  it('arrow keys walk the strip and wrap at both ends', () => {
    const items = [{ key: 'genome' }, { key: 'form' }, { key: 'skies' }];
    expect(stepTab(items, 'genome', 1)).toBe('form');
    expect(stepTab(items, 'skies', 1)).toBe('genome');
    expect(stepTab(items, 'genome', -1)).toBe('skies');
  });
});
