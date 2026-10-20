// founding-titles — the canonical house roles (v3.2 OPTIO-SECOND, Founder
// 2026-09-13 — the Optio stands directly under the Rector as house manager; v3.1
// CORPORATE-ANCHORED, Founder + Kimi 2026-07-21; the SECURITY/LAW split, Design note, 2026-07-24: every scaling house's fundamental functions, each title a
// real Roman position that did the work we name it for, tied to the corporate
// executive seat the function answers to in the world outside — the legend a
// founder already knows from any company, spelled out in full so the seat is
// never a bare acronym. The FOUNDING seats are the seats a house must hold
// from day one; the GROWTH seats fill in as the house scales, before any
// subdivision into sub-positions. Two doctrines hold the seams: RESEARCH is
// not the CTO's pressing work — it explores what may or may not serve later,
// so it stands its own seat (Speculator); and MARKETING is not COMMUNICATIONS
// — one makes the house known, the other carries the word out and back, so
// they stand side by side (Legatus, Praeco), never merged; and SECURITY is
// not LEGAL (ruling, 2026-07-24) — one guards the digital walls (Praefectus, the
// commander of the guard), the other answers the world's regulations and
// contracts (Praetor, the magistrate of law) — both FOUNDING, security no
// less fundamental than law. And between the
// Rector and the house stands the Optio (the manager charge, Design note, 2026-09-13
// — the Roman second who carried the commander's word down the line and
// kept the ranks in step, now the house's manager: the operator's standing
// delegate inside the house, ranked below the commander, never above the
// line. It holds the house's standing work, dispatches every seat, tracks
// each charge to done, and reports back — the first office a working house
// opens, because it is the seat that keeps all the others in step. Its
// authority flows from the operator's approved plans, never around them:
// the operator commands; the Optio carries that command into the house.
// The FUNCTION is what a founder carries; the label is theirs to change — any
// word entered goes into the record exactly as given.
// PURE data. The human-readable canon lives in docs/governance/house-roles.md — a
// unit test (house-roles-doc.test.js) pins that page to this legend; change
// them together.

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
