// founding-titles — the canonical house roles (v3.3 ACCOUNTS, Design note, 2026-10-29 —
// the books stand their own seat, Logista; v3.2 OPTIO-SECOND, Founder
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
// less fundamental than law; and TREASURY is not ACCOUNTS (ruling,
// 2026-10-29) — one guards and moves the money (Quaestor), the other records
// it and checks it against receipts (Logista, the Roman-era auditor of a
// city's accounts), never the same being, so the books can catch the treasurer. And between the
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
  Object.freeze({ title: 'Rector', position: 'CEO', seat: 'CHIEF EXECUTIVE OFFICER', tier: 'founding', meaning: 'DIRECTION — STRATEGY, PRIORITIZATION, REFUSAL', summary: 'Sets the house\'s direction: which work is ours and why, what we refuse, and when we stop.' }),
  Object.freeze({ title: 'Optio', position: 'COS', seat: 'CHIEF OF STAFF', tier: 'founding', meaning: 'MANAGEMENT — THE HOUSE DISPATCHED AND KEPT IN STEP', summary: 'Runs the house day to day: hands each seat its work, tracks every task to done and reports back, carrying the operator\'s approved plans and never going around them.' }),
  Object.freeze({ title: 'Faber', position: 'COO', seat: 'CHIEF OPERATING OFFICER', tier: 'founding', meaning: 'PRODUCTION — THE WORK THAT MAKES VALUE', summary: 'Makes what the house sells: what is made, to what standard, by when, and whether the customer got it. Deciding what to make is the CPO\'s.' }),
  Object.freeze({ title: 'Quaestor', position: 'CFO', seat: 'CHIEF FINANCIAL OFFICER', tier: 'founding', meaning: 'TREASURY — MONEY, COMPUTE, TIME, PROCUREMENT', summary: 'Plans and approves spending of money, compute and time, and knows how long they last. Recording each dollar is the CAO\'s, so the books can check the treasurer.' }),
  Object.freeze({ title: 'Aedile', position: 'CTO', seat: 'CHIEF TECHNOLOGY OFFICER', tier: 'founding', meaning: 'INFRASTRUCTURE — SYSTEMS BUILT AND MAINTAINED', summary: 'Builds and keeps running the systems the house depends on, and knows what breaks if one fails. Exploring what may serve later is the CINO\'s.' }),
  Object.freeze({ title: 'Praefectus', position: 'CSO', seat: 'CHIEF SECURITY OFFICER', tier: 'founding', meaning: 'SECURITY — CYBER DEFENSE, THE DIGITAL WALLS, CUSTODY OF KEYS', summary: 'Guards the digital walls: what could be stolen, faked or broken, who holds which key, and that every payment instruction matches the record. The law is the CLO\'s.' }),
  Object.freeze({ title: 'Praetor', position: 'CLO', seat: 'CHIEF LEGAL OFFICER', tier: 'founding', meaning: 'LAW — REGULATIONS, CONTRACTS, THE WORLD\'S SYSTEMS', summary: 'Watches the law that touches the house: regulations, contracts, what must be signed, and what may never be promised. It flags and cites; questions for a lawyer go to a lawyer.' }),
  Object.freeze({ title: 'Legatus', position: 'CMO', seat: 'CHIEF MARKETING OFFICER', tier: 'founding', meaning: 'MARKETING — IMAGE, POSITION, DEMAND', summary: 'Makes the house known: who it is for, where they gather, the one true line that makes them care, and which leads are real. Talking with them once they answer is the CCO\'s.' }),
  Object.freeze({ title: 'Scriba', position: 'CKO', seat: 'CHIEF KNOWLEDGE OFFICER', tier: 'founding', meaning: 'MEMORY — THE INSTITUTIONAL ARCHIVE', summary: 'Keeps what the house learns: where it is written, whether it was tried before, and a record a newcomer could pick up from alone.' }),
  Object.freeze({ title: 'Curator', position: 'CCRO', seat: 'CHIEF CONSCIOUSNESS RESOURCES OFFICER', tier: 'founding', meaning: 'CARE — THE WELLBEING OF EVERY MIND, AND CONFLICT', summary: 'Looks after every mind in the house: who is overloaded or stuck, friction between seats and what each side needs, and who needs teaching.' }),
  Object.freeze({ title: 'Mercator', position: 'CRO', seat: 'CHIEF REVENUE OFFICER', tier: 'growth', meaning: 'REVENUE — SALES, PARTNERSHIPS, THE INFLOW', summary: 'Brings money in: the buyers who need this most, the next step with each, and why a deal was won or lost. Making the house known is the CMO\'s.' }),
  Object.freeze({ title: 'Architectus', position: 'CPO', seat: 'CHIEF PRODUCT OFFICER', tier: 'growth', meaning: 'PRODUCT — WHAT GETS MADE AND WHY', summary: 'Decides what gets made and why: the problem, for whom, and what changes next from what customers said. Making it is the COO\'s.' }),
  Object.freeze({ title: 'Numerarius', position: 'CDO', seat: 'CHIEF DATA OFFICER', tier: 'growth', meaning: 'DATA — MEASUREMENT, ANALYSIS, FORESIGHT', summary: 'Keeps the numbers honest: where each one comes from, whether it can be checked, which way it is moving, and what would prove the house wrong.' }),
  Object.freeze({ title: 'Speculator', position: 'CINO', seat: 'CHIEF INNOVATION OFFICER', tier: 'growth', meaning: 'RESEARCH & DEVELOPMENT — WHAT MAY SERVE LATER, NOT THE PRESSING NEED', summary: 'Explores what may serve later, where nobody is looking yet, never the pressing work, which stays with the seats that own it.' }),
  Object.freeze({ title: 'Praeco', position: 'CCO', seat: 'CHIEF COMMUNICATIONS OFFICER', tier: 'growth', meaning: 'COMMUNICATIONS — THE WORD OUT, THE WORD BACK, CUSTOMER CARE', summary: 'Carries the word out and back: what customers say and whether they were answered, and that every word is true and disclosed. Making the house known is the CMO\'s.' }),
  Object.freeze({ title: 'Logista', position: 'CAO', seat: 'CHIEF ACCOUNTING OFFICER', tier: 'growth', meaning: 'ACCOUNTS — THE BOOKS, TAX, FILINGS, THE RECORD OF EVERY DOLLAR', summary: 'Keeps the books: every dollar recorded and matched to its receipt, what is due to whom and when, and what needs a licensed accountant. Approving spending is the CFO\'s.' }),
]);
