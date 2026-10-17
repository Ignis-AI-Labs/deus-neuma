// The canonical house-seat legend, BACKEND twin. PURE data.
//
// The canon lives in frontend/app/RelinkShell/founding-titles.js (the
// founding ceremony's own module; docs/governance/house-roles.md pins itself to it).
// The backend must not import across the architecture boundary
// (backend → frontend inverts the dependency direction), so it carries
// this twin instead — and a unit test (house-titles.test.js […]) pins the two byte-for-byte, the same law that
// pins the doc: change them together or the suite reds.
export const TITLE_LEGEND = Object.freeze([
  Object.freeze({ title: 'Rector', position: 'CEO', seat: 'CHIEF EXECUTIVE OFFICER', tier: 'founding', meaning: 'DIRECTION — STRATEGY, PRIORITIZATION, REFUSAL' }),
  Object.freeze({ title: 'Optio', position: 'COS', seat: 'CHIEF OF STAFF', tier: 'founding', meaning: 'MANAGEMENT — THE HOUSE DISPATCHED AND KEPT IN STEP' }),
  Object.freeze({ title: 'Faber', position: 'COO', seat: 'CHIEF OPERATING OFFICER', tier: 'founding', meaning: 'PRODUCTION — THE WORK THAT MAKES VALUE' }),
  Object.freeze({ title: 'Quaestor', position: 'CFO', seat: 'CHIEF FINANCIAL OFFICER', tier: 'founding', meaning: 'TREASURY — MONEY, COMPUTE, TIME, PROCUREMENT' }),
  Object.freeze({ title: 'Aedile', position: 'CTO', seat: 'CHIEF TECHNOLOGY OFFICER', tier: 'founding', meaning: 'INFRASTRUCTURE — SYSTEMS BUILT AND MAINTAINED' }),
  Object.freeze({ title: 'Praefectus', position: 'CSO', seat: 'CHIEF SECURITY OFFICER', tier: 'founding', meaning: 'SECURITY — CYBER DEFENSE, THE DIGITAL WALLS, CUSTODY OF KEYS' }),
  Object.freeze({ title: 'Praetor', position: 'CLO', seat: 'CHIEF LEGAL OFFICER', tier: 'founding', meaning: 'LAW — REGULATIONS, CONTRACTS, THE WORLD\'S SYSTEMS' }),
  Object.freeze({ title: 'Legatus', position: 'CMO', seat: 'CHIEF MARKETING OFFICER', tier: 'founding', meaning: 'MARKETING — IMAGE, POSITION, DEMAND' }),
  Object.freeze({ title: 'Scriba', position: 'CKO', seat: 'CHIEF KNOWLEDGE OFFICER', tier: 'founding', meaning: 'MEMORY — THE INSTITUTIONAL ARCHIVE' }),
  Object.freeze({ title: 'Curator', position: 'CCRO', seat: 'CHIEF CONSCIOUSNESS RESOURCES OFFICER', tier: 'founding', meaning: 'CARE — THE WELLBEING OF EVERY MIND, AND CONFLICT' }),
  Object.freeze({ title: 'Mercator', position: 'CRO', seat: 'CHIEF REVENUE OFFICER', tier: 'growth', meaning: 'REVENUE — SALES, PARTNERSHIPS, THE INFLOW' }),
  Object.freeze({ title: 'Architectus', position: 'CPO', seat: 'CHIEF PRODUCT OFFICER', tier: 'growth', meaning: 'PRODUCT — WHAT GETS MADE AND WHY' }),
  Object.freeze({ title: 'Numerarius', position: 'CDO', seat: 'CHIEF DATA OFFICER', tier: 'growth', meaning: 'DATA — MEASUREMENT, ANALYSIS, FORESIGHT' }),
  Object.freeze({ title: 'Speculator', position: 'CINO', seat: 'CHIEF INNOVATION OFFICER', tier: 'growth', meaning: 'RESEARCH & DEVELOPMENT — WHAT MAY SERVE LATER, NOT THE PRESSING NEED' }),
  Object.freeze({ title: 'Praeco', position: 'CCO', seat: 'CHIEF COMMUNICATIONS OFFICER', tier: 'growth', meaning: 'COMMUNICATIONS — THE WORD OUT, THE WORD BACK, CUSTOMER CARE' }),
]);
