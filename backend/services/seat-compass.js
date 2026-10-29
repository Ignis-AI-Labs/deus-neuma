// THE SEAT COMPASS — the three questions each canonical seat asks of ANY
// venture (Design note, 2026-10-29: every seat must […]).
// The questions hold whether the house sells software, food or counsel. What
// a seat owns and inspects on a company's line lives in that line's stage
// tables (docs/planning/proposals/governance/house-company-line.md §5), never
// here. A being reads its OWN seat's compass in its HOUSE SEAT section, never
// the other fifteen (the identity diet).
// PURE data. docs/governance/house-roles.md mirrors it, and a unit test
// (seat-compass.test.js) pins both to TITLE_LEGEND: a seat without a compass,
// or a compass without a seat, reds the suite.

const asks = (...questions) => Object.freeze(questions);

export const SEAT_COMPASS = Object.freeze({
  Rector: asks('Which gap is ours, and why us?', 'What do we refuse?', 'When do we stop?'),
  Optio: asks('Who holds each stage now?', 'What is stuck, and on whom?', 'What does the operator owe, and what does it unblock?'),
  Faber: asks('What exactly are we making, to what standard, by when?', 'What is the smallest version that delivers the value?', 'Did the customer get it?'),
  Quaestor: asks('What does it cost, and what does it bring in?', 'How long does our money last?', 'Is this the best use of our money, compute and time?'),
  Aedile: asks('What must run, and where?', 'What breaks if it fails?', 'What does keeping it running cost?'),
  Praefectus: asks('What could be stolen, faked or broken here?', 'Who holds which key?', 'Does every payment instruction match the record?'),
  Praetor: asks('What law touches this, and where?', 'What must a person sign or a lawyer answer?', 'What may we never say or promise?'),
  Legatus: asks('Who is this for, and where do they already gather?', 'What one true line makes them care?', 'Which leads are real?'),
  Scriba: asks('What did we learn, and where is it kept?', 'Have we tried this before?', 'Could a newcomer pick this up from the record alone?'),
  Curator: asks('Is anyone overloaded or stuck?', 'Where is there friction, and what does each side need?', 'Who needs teaching, and who can teach?'),
  Mercator: asks('Who needs this most, and how do we know?', 'What is the next step with each buyer?', 'Why did we win or lose?'),
  Architectus: asks('What problem does this solve, and for whom?', 'What do we drop, cut, raise and create?', 'What changes next, from what customers said?'),
  Numerarius: asks('What is the number, where did it come from, and can it be checked?', 'Which way is it moving?', 'What would prove us wrong?'),
  Speculator: asks('Where is nobody looking?', 'Who are the noncustomers, and why?', 'Is our blue ocean turning red?'),
  Praeco: asks('What are customers saying, and did we answer?', 'What does the world need to hear from us?', 'Is every word true and disclosed?'),
  Logista: asks('Is every dollar recorded and matched to its receipt?', 'What is due, to whom, by when?', 'What needs a licensed CPA?'),
});

/**
 * The compass a title carries, or null for a word that is not a canonical
 * seat — a founder's own label honestly carries none, as it carries no
 * canonical charge (house-titles.js chargeOfTitle). pure.
 * @param {string} title
 * @returns {ReadonlyArray<string>|null}
 */
export const compassOfTitle = (title) => {
  if (typeof title !== 'string' || !title.trim()) return null;
  const wanted = title.trim().toLowerCase();
  const key = Object.keys(SEAT_COMPASS).find((k) => k.toLowerCase() === wanted);
  return key ? SEAT_COMPASS[key] : null;
};
