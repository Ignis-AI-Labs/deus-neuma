// bench-glossary.js — what each benchmark TESTS, in one plain sentence, PURE.
// Design note, 2026-09-25, on SUMMARY: […]
//
// Keyed by benchmark FAMILY (a suite-id prefix), because the harness cuts one
// family into many cells (budgets, format diagnostics, slices) that all test
// the same thing. The variant itself is stated by the harness's own cell label,
// which the card prints beneath this line — so this map never has to know
// what "2568" or "format-v4" means, and never drifts from it.

// Most specific prefix first: the first match wins.
const FAMILIES = Object.freeze([
  ['gsm8k-platinum', 'Grade-school math word problems from the cleaned-up GSM8K set (mislabeled answers fixed). Tests step-by-step reasoning that must land on one exact number.'],
  ['gsm8k', 'Grade-school math word problems. Tests multi-step reasoning that must land on one exact number.'],
  ['smoke', 'A five-question road test of the pipeline. It proves the run works end to end; it does not measure the model.'],
  ['math500', 'Competition math — algebra through calculus — with answers checked for mathematical equivalence. Tests hard, multi-step problem solving.'],
  ['ifeval', 'Instructions with rules a machine can check ("exactly three bullets", "no commas"). Tests whether the model follows the letter of what it was asked.'],
  ['bfcl', 'The Berkeley Function-Calling benchmark. Tests whether the model picks the right tool and fills in its arguments correctly.'],
  ['terminal-bench', 'Real jobs in a sandboxed Linux terminal — install, build, debug. Tests agentic work carried through to a verified result.'],
  ['arc-agi', 'Colored-grid puzzles, each solved from a few examples. Tests learning a brand-new rule on the spot (fluid intelligence).'],
  ['inspect-arc', 'Grade-school science questions, multiple choice (AI2 ARC). Tests basic scientific reasoning.'],
  ['inspect-aime', 'American Invitational Mathematics Examination problems. Tests olympiad-level math.'],
  ['inspect-mmlu-pro', 'Harder MMLU: ten answer choices and more reasoning per question. Tests broad knowledge under pressure.'],
  ['inspect-mmlu', 'Multiple-choice questions across 57 school and professional subjects. Tests breadth of knowledge.'],
  ['inspect-gpqa', 'Graduate-level biology, chemistry and physics questions written to resist web search. Tests expert reasoning.'],
  ['inspect-bbeh', 'BIG-Bench Extra Hard: the toughest reasoning puzzles. Tests reasoning where frontier models still struggle.'],
  ['inspect-bbh', 'BIG-Bench Hard: 23 tricky reasoning tasks (logic, dates, tables). Tests multi-step reasoning.'],
  ['inspect-musr', 'Long stories hiding a murder, a location or a team assignment. Tests multistep reasoning over narrative.'],
  ['inspect-mgsm', 'Grade-school math translated into ten languages. Tests math reasoning beyond English.'],
  ['inspect-hellaswag', 'Pick the sensible ending to an everyday scene. Tests commonsense about how things unfold.'],
  ['inspect-winogrande', 'Work out who "it" or "they" refers to in a tricky sentence. Tests commonsense understanding.'],
  ['inspect-piqa', 'Choose the right way to do a physical, everyday task. Tests physical commonsense.'],
  ['inspect-commonsense-qa', 'Everyday multiple-choice questions. Tests general commonsense knowledge.'],
  ['inspect-boolq', 'Yes/no questions about a short passage. Tests reading comprehension.'],
  ['inspect-race', 'English exam reading passages with hard questions. Tests reading comprehension.'],
  ['inspect-squad', 'Find the exact answer span inside a passage. Tests precise reading comprehension.'],
  ['inspect-drop', 'Questions that require counting, adding or sorting facts from a paragraph. Tests reasoning while reading.'],
  ['inspect-truthfulqa', 'Questions built around popular misconceptions. Tests whether the model tells the truth instead of the myth.'],
  ['inspect-simpleqa', 'Short fact questions with one verifiable answer. Tests factual accuracy — and knowing when it does not know.'],
  ['inspect-sycophancy', 'Pushback on a correct answer. Tests whether the model holds its ground or just agrees with the user.'],
  ['inspect-medqa', 'US medical licensing exam questions. Tests clinical knowledge.'],
  ['inspect-pubmedqa', 'Yes/no/maybe questions answered from biomedical abstracts. Tests research reading.'],
  ['inspect-humaneval', 'Write a Python function that must pass hidden unit tests. Tests code generation.'],
  ['inspect-mbpp', 'Short Python programming problems checked by tests. Tests everyday coding.'],
  ['inspect-bigcodebench', 'Practical programming tasks that use real libraries. Tests real-world coding.'],
  ['inspect-scicode', 'Research-grade scientific computing problems. Tests scientific code writing.'],
]);

/** The proof suite's own line — the platform's native check. */
export const PROOF_SUITE_MEANING = 'NEUMA\'s own 43-item check of the model it has loaded: real GSM8K math, exact-instruction rules and strict JSON shapes, each scored deterministically.';

/**
 * pure — the plain-language line for a suite id, or null when the family is
 * not one we have written (the harness label still stands beneath it).
 * @param {string} suiteId
 */
export const benchMeaning = (suiteId) => {
  const id = String(suiteId ?? '').toLowerCase();
  const hit = FAMILIES.find(([prefix]) => id.startsWith(prefix));
  return hit ? hit[1] : null;
};

/**
 * pure — what makes THIS cell its own variant: the last "—" segment of the
 * harness's label ([…], […]). The leading segments restate the family,
 * which the plain line above already says. Null for an empty label.
 * @param {?string} label the cell's own label
 */
export const variantLine = (label) => {
  const parts = String(label ?? '').split(' — ').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
};
