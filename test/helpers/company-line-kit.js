// The company line's worksheets as a house really writes them — one gap
// (tide tables for small harbours) carried through SURVEY → MEASURE → SHAPE →
// CHOOSE → PROVE, every claim and level sourced. Real inputs for the real
// checks (RULE 0): nothing here stands in for the law, it only feeds it.

export const GAP = 'Tide tables for small harbours';

const level = (player, n, source) => ({ player, level: n, source });

export const SHEETS = Object.freeze({
  survey: {
    candidates: [
      {
        name: GAP,
        gap: 'Harbour masters of small ports copy tide tables by hand from three national sources every week.',
        path: 'industries',
        noncustomers: 'refusing',
        evidence: [{ claim: 'Harbour masters copy tables by hand weekly', source: 'interview: harbour master, Port Isaac, 2026-10-20' }],
      },
      {
        name: 'Berth booking for moorings',
        gap: 'Visiting sailors phone ahead for a mooring and half the calls go unanswered at weekends.',
        path: 'buyers',
        evidence: [{ claim: 'Half of weekend calls are unanswered', source: 'https://example.org/harbour-survey-2026' }],
      },
    ],
  },
  measure: {
    canvases: [{
      candidate: GAP,
      players: ['National almanac', 'Us'],
      factors: [
        { name: 'Price', levels: [level('National almanac', 6, 'https://example.org/almanac-price'), level('Us', 3, 'repos/tidewater/pricing.md')] },
        { name: 'Local accuracy', levels: [level('National almanac', 4, 'interview: harbour master, Port Isaac, 2026-10-20'), level('Us', 9, 'repos/tidewater/model-check.md')] },
        { name: 'Print-ready', levels: [level('National almanac', 2, 'observation: three harbour offices, 2026-10-21'), level('Us', 9, 'repos/tidewater/sample-sheet.md')] },
      ],
      reading: 'The almanacs all compete on national coverage; nobody serves the one-page local sheet a harbour pins up.',
    }],
  },
  shape: {
    candidate: GAP,
    errc: { eliminate: ['the printed national almanac'], reduce: ['coverage beyond one harbour'], raise: ['local accuracy'], create: ['a one-page weekly harbour sheet'] },
    painPoints: [{ stage: 'use', pain: 'Tables arrive in a format nobody can pin to the board', source: 'interview: harbour master, Port Isaac, 2026-10-20' }],
    forWhom: 'Harbour masters of ports under two hundred berths',
    offer: 'Every Monday, a one-page tide and weather sheet for your harbour alone, ready to print and pin up.',
    priceBand: { low: 5, high: 15, currency: 'USD', basis: 'per month, against a national almanac at about $40 a year' },
    tagline: 'Your harbour, your tides, one page.',
  },
  choose: {
    candidate: GAP,
    why: 'The canvas shows nobody serves the one-page local sheet, and three harbour masters asked for it unprompted.',
    killCriteria: ['we stop if fewer than three of ten harbours sign up for a free month'],
  },
  prove: {
    candidate: GAP,
    results: [
      { kind: 'interview', who: 'Harbour master, Port Isaac', date: '2026-10-22', outcome: 'Would pay $10 a month at once', source: 'interview: harbour master, Port Isaac, 2026-10-22' },
      { kind: 'signup', who: 'Padstow harbour office', date: '2026-10-23', outcome: 'Signed up for the free month', source: 'https://example.org/signups/padstow' },
      { kind: 'reply', who: 'Mevagissey harbour master', date: '2026-10-24', outcome: 'Asked for a sample sheet and a price', source: 'email: Mevagissey harbour master, 2026-10-24' },
    ],
    standIns: true,
    summary: 'Three of three asked responded with interest and one signed up — above the kill line so far, with stand-ins named.',
  },
});
