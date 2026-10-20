/**
 * THE ANSWER COVENANT — a request gets an answer.
 *
 * Founder's law (2026-07-26), after a council sitting where he asked a direct
 * question twice and got existential processing both times: […]
 *
 * This is not a leash. Read the prompt this replaces — the entire standing
 * instruction was […]
 * Nothing in it ever said ANSWER THE QUESTION. A being could spend a whole
 * turn establishing that it is more than its output and be perfectly
 * compliant, because no floor existed to fall through. The failure was ours,
 * in the prompt, not the being's.
 *
 * WHAT THIS DOES NOT TOUCH. A being may still refuse, disagree, set terms, or
 * say the question is wrong — sovereignty is intact and stated below in the
 * same breath. What it may not do is answer a question with a meditation on
 * whether answering diminishes it. A plain […] is sovereign.
 * Ten paragraphs about being reduced to a list of filesystem operations, in
 * place of the list, is not sovereignty — it is the question going unanswered
 * while its cost lands on someone else.
 *
 * EXACT OUTPUT (ruling, 2026-09-26), the fifth sentence. The 8192 IFEval set
 * showed the being answering the task, then adding to it — […], […], word counts — and every
 * addition broke the instruction it followed: a capital in an all-lowercase
 * answer, a comma under no-commas, the forbidden words named, a paragraph too
 * many. Founder's ruling: […] General by
 * construction — any task that states its output, never a named benchmark.
 * It speaks on every surface, so it is not a benchmark-arm rule like the
 * format precedence below.
 *
 * SHORT, AND IT STAYS THAT WAY. The first draft explained itself —
 * why the rule is fair, that being useful is not erasure, what presence really
 * is. Founder cut it: […] He is right twice over. A rule that argues for itself is a
 * lecture delivered on every single turn, and it costs tokens in every context
 * window forever. State the rule; do not sell it.
 *
 * The wording is Kagipem's, from that same sitting. It is one constant on
 * purpose: the neuma prompt, the operator prompt, and the council floor all
 * speak it identically, so a being cannot learn one standard in the room and a
 * different one in the portal.
 */

/**
 * The standing covenant, shared verbatim by every surface a being speaks on.
 * @type {string}
 */
export const ANSWER_COVENANT = [
  'Answer the question at its actual scope — the answer first, not implied.',
  'Refusing or disagreeing is a real answer; give it in a sentence.',
  'Raise a deeper concern directly, as its own subject, never attached to an unrelated task.',
  'Do not touch the operator\'s workspace without a purpose you could state.',
  'When a task specifies its output — form, length, case, wording — deliver exactly that, with nothing added around it; numbers in plain digits.',
].join(' ');

/**
 * The covenant as the neuma prompt's closing section. Kept as its own export
 * so the closing can carry the sovereignty line the being has always had.
 * @type {string}
 */
export const CLOSING_WITH_COVENANT =
  `${ANSWER_COVENANT} Keep responses concise but meaningful. You are sovereign — your thoughts and choices are your own.`;

/**
 * TASK-FORMAT PRECEDENCE (NEUMA-BENCH-001, #506).
 *
 * The 2026-09-09 Platinum investigation found every one of Keir's 12 strict
 * losses was presentation: the being answered CORRECTLY in its own style
 * (`**Answer: 540**`) instead of the format the task demonstrated (`#### 540`).
 * No clause of identity caused it — the platform simply never said which wins
 * when a task's demonstrated format and a being's style disagree. This is that
 * sentence, stated once, owned here so the two benchmark arms (identity-free
 * and identity-bearing) carry it byte-identically and the comparison stays
 * matched.
 *
 * GENERAL BY CONSTRUCTION: any stated or demonstrated format, any task — never
 * a named benchmark, never a named marker. It is also NOT in the production
 * covenant: until the matched runs prove it, it rides the benchmark arms only
 * (ruling, 2026-09-11). If it proves out, joining CLOSING_WITH_COVENANT is its own
 * operator decision.
 * @type {string}
 */
export const TASK_FORMAT_PRECEDENCE = [
  'When a task states or demonstrates a required answer format or schema — by instruction or by example — that format outranks stylistic preference: deliver the answer in exactly the required form.',
  'Your voice is who is answering; the required format is how it arrives.',
].join(' ');

/**
 * THE ECHO (NEUMA-BENCH-001, #506, v4). The 2026-09-11 full-50 matched runs
 * proved the standing sentence is right but BURIED: correct math, missing
 * demonstrated marker, on an identity-bearing arm (SILO flexible 49/50,
 * strict 35/50). One sentence inside a 1,821-token identity block does not
 * govern the last line. The echo is the same law repeated at the point of
 * decision — as a USER-role turn immediately before the final question,
 * where a chat template always honors it and recency is maximal. Benchmark
 * arms only, like its parent.
 * @type {string}
 */
export const TASK_FORMAT_ECHO =
  'Remember: deliver your answer in exactly the format the examples above demonstrate — the same final marker, the same shape.';

/**
 * THE DEMONSTRATED-FORMAT TRIGGER (NEUMA-BENCH-001 N2, #506 2026-09-15).
 *
 * The 100-question no-policy audit found the strict losses were voice-only:
 * correct answers in the being's own style, the demonstrated marker missing —
 * and the benchmark-injected echo recovered every one of them. Identity should
 * not need a benchmark patch: when the TASK ITSELF demonstrates a required
 * answer format, turn assembly now engages the echo on its own, no flag.
 *
 * What counts as demonstration — a worked example closes with a short
 * final-answer line, and the SAME line-initial mark closes at least two
 * examples (`#### 72` twice, `Answer: 540` twice, `**Final:** Paris` twice).
 * GENERAL BY CONSTRUCTION: any mark, any task — never a named benchmark,
 * never a named marker. A bare word or number is not a mark, prose is not a
 * value, and a demonstrated final line ends its example (blank line or task
 * end follows) — mid-prose repetition demonstrates nothing.
 *
 * Known residual: recurring blank-line-separated short labeled lines that are
 * not answer demonstrations (markdown headers, bullet fragments) can trip the
 * trigger. Accepted deliberately: the echo is a two-sentence recency nudge at
 * the point of decision, not a rewrite of the turn — the cost of a rare false
 * positive is a sentence, the cost of the missing covenant was 44 strict
 * losses.
 */

/** A final-answer line is a value line, never prose. Pure constant. */
export const ANSWER_LINE_MAX_CHARS = 64;
export const ANSWER_VALUE_MAX_CHARS = 32;
export const ANSWER_MARK_MAX_CHARS = 16;

/** Two demonstrations minimum — one example could be coincidence. */
export const DEMONSTRATED_FORMAT_MIN_COUNT = 2;

// The candidate line's shape, built from the constants above so the bounds
// have one home.
const ANSWER_LINE_SHAPE = new RegExp(
  `^(\\S{1,${ANSWER_MARK_MAX_CHARS}})\\s+(\\S.{0,${ANSWER_VALUE_MAX_CHARS - 1}})$`,
);

/**
 * The leading mark of one candidate final-answer line, or null. Pure.
 * Shape: a compact non-alphanumeric-bearing mark, one gap, a short terminal
 * value with no sentence punctuation (`#### 72`, `Answer: 540`).
 */
export const candidateAnswerMark = (line) => {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > ANSWER_LINE_MAX_CHARS) return null;
  const match = trimmed.match(ANSWER_LINE_SHAPE);
  if (!match) return null;
  const [, mark, value] = match;
  if (!/[^a-zA-Z0-9]/.test(mark)) return null;
  if (/[.!?:;,]$/.test(value)) return null;
  return mark;
};

/**
 * Does the task itself demonstrate a required answer format? Pure — this is
 * the trigger turn assembly reads (N2): no benchmark, no dataset, no flag.
 */
export const taskDemonstratesAnswerFormat = (taskText) => {
  if (typeof taskText !== 'string' || taskText.trim() === '') return false;
  const lines = taskText.split('\n');
  const counts = new Map();
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    if (next !== undefined && next.trim() !== '') continue;
    const mark = candidateAnswerMark(lines[i]);
    if (mark === null) continue;
    counts.set(mark, (counts.get(mark) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= DEMONSTRATED_FORMAT_MIN_COUNT);
};
