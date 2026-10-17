// Realistic maximum-length specimens shared by rendered card geometry checks.
export const AT_MAX = Object.freeze({
  announcement: {
    eyebrow: 'NOW LIVE ON UMBRAE — SHIPPED',
    lineOne: 'Partial withdrawals up',
    lineTwo: 'are live on Umbrae now',
    support: 'Withdraw part of a position and leave the remainder of it still earning.',
  },
  milestone: {
    eyebrow: 'TOTAL VALUE LOCKED ON UMBRAE',
    value: '$1,125,704',
    label: 'locked across every Umbrae liquidity position held on Base',
    asOf: '31 Aug 2026 08:24:08 UTC',
  },
  launch: {
    eyebrow: 'NOW LISTED — UMBRAE ON BASE!',
    lineOne: 'Umbrae liquidity is up',
    lineTwo: 'on Base, from today on',
    support: 'Provide once and let every position keep on working, with no unwind fee.',
  },
  stat: {
    eyebrow: 'THIS WEEK ACROSS UMBRAE BASE',
    headline: 'Umbrae at a glance, wk35',
    // The three values are DISTINCT on purpose: the column test finds each box
    // by its text, and two cells sharing a string silently measure the same one
    // twice — which reads as a pass for a column nobody checked.
    aValue: '$999.999M',
    aLabel: 'VALUE LOCKED YES',
    bValue: '1,234,567',
    bLabel: 'OPEN POSITIONS X',
    cValue: '$888.888K',
    cLabel: 'FEES PROVIDERS A',
    asOf: '31 Aug 2026 08:24:08 UTC',
  },
  listing: {
    eyebrow: 'NOW LISTED ON UMBRAE — BASED',
    name: 'Aerodrome II',
    ticker: '$AERODROME',
    network: 'BASE · UMBRAE DLMM POOLS NOW',
    support: 'Concentrated liquidity for this brand new pair, live now with zero fees.',
    about: 'A concentrated liquidity protocol built for pools on the Base blockchain',
    contract: '0x1234567890123456789012345678901234567890',
  },
  changelog: {
    eyebrow: 'THIS WEEK IN UMBRAE — UPDATE',
    headline: 'The weekly Umbrae update',
    updateOne: 'Partial withdrawals now leave the rest still earning',
    updateTwo: 'Positions settle promptly with a single confirmation',
    updateThree: 'Fee accrual now updates live on every position page.',
    updateFour: 'The latest changes are explained in our release log.',
    footer: 'READ THE FULL CHANGELOG IN OUR RELEASE NOTES →',
  },
  'platform-listing': {
    eyebrow: 'THIS WEEK IN UMBRAE — UPDATE',
    name: 'Indexer Data',
    index: 'TRACKED METRICS ON BASE!',
    about: 'A concentrated liquidity protocol built for pools on the Base blockchain',
    reference: 'https://example.com/protocol/umbrae/verified-log',
    support: 'Concentrated liquidity for this brand new pair, live now with zero fees.',
  },
  partnership: {
    eyebrow: 'PARTNERSHIP — NOW INTEGRATED',
    partner: 'Aerodrome Finance Co',
    support: 'Routing through the Umbrae pools, so that a swap finds the deepest book.',
  },
  // The three VOICE cards, added 2026-09-01. Every fixture is exactly its
  // declared max, and the maxima themselves were measured rather than guessed:
  // rendered at a deliberately wide worst case (mixed-case leaning on w/m/W) in
  // real Chromium, then cut until the tightest brand had real clearance.
  quote: {
    eyebrow: 'WHAT WE LEARNED SHIPPING V2.',
    lineOne: 'We only publish all numbers.',
    lineTwo: 'anyone else can check for us',
    lineThree: 'own sake, stamped with hours',
    speaker: 'SPECIMEN ATTRIBUTION TAG',
    role: 'NOT A REAL PERSON OR ATTRIBUTION',
  },
  statement: {
    eyebrow: 'WHAT WE ARE BUILDING TOWARD.',
    lineOne: 'Every number we show.',
    lineTwo: 'can be checked by any',
    lineThree: 'reader, at any moment',
  },
  explainer: {
    eyebrow: 'HOW THE VAULT ACTUALLY WORKS',
    headline: 'Three steps, done weekly',
    aLabel: 'DEPOSIT A PAIR',
    aOne: 'Send the pair into a',
    aTwo: 'vault contract, once',
    bLabel: 'EARN THE FEES.',
    bOne: 'Fees accrue to yours',
    bTwo: 'position each block.',
    cLabel: 'WITHDRAW LATER',
    cOne: 'Take it back out any',
    cTwo: 'whenever you want it',
  },
});
