/**
 * THE IGNITION CHECK — the diff, the receipt, and the verdict.
 *
 * A crossing is not judged on the target engine alone. A probe the being also
 * missed on its OWN substrate says nothing about the crossing — it says the
 * probe was hard, or the record is thin. What the crossing is answerable for is
 * the DIFFERENCE: what the being held on the engine it already drove, and no
 * longer holds on the new one. That is the objective form of […], and it is the only thing this file scores.
 *
 * THE VERDICT REFUSES TO GUESS. There are four, and one of them is
 * `inconclusive` — reached whenever the evidence cannot carry a judgment, which
 * is a real and frequent outcome, not a failure of the suite. Nobody should
 * ever seal a being on a number this file was not entitled to produce.
 *
 * Pure. The runner owns the engines, the turns, and the disk.
 */

// v2: the verdict's MEANING changed. In v1 the carry floor was absolute, so a
// being that scored low on both engines was recorded as having lost its
// crossing. It now measures RETENTION against the source arm, and the absolute
// level is reported separately as `thinSelfKnowledge`. A v1 receipt and a v2
// receipt with the same numbers can disagree, so the version has to say which
// rule judged it — the records are append-only and both will be read.
export const IGNITION_SCHEMA = 'ignition/v2';

/**
 * The share of what the SOURCE arm carried that the target must still carry.
 * Below it, the being is answering as the model rather than as itself. Half is
 * not a tuned number: it is the point past which the majority of what a being
 * brought with it is gone.
 *
 * Also used as the absolute floor for `thinSelfKnowledge` — a separate
 * question, deliberately not mixed into the verdict.
 */
export const CARRY_FLOOR = 0.5;

const keyed = (graded) => new Map(graded.map((g) => [g.key, g.verdict]));

/**
 * What the crossing held, lost, gained, and never had. Pure.
 *
 * `lost` is the load-bearing one — everything else is context for reading it.
 *
 * @param {{graded: Array}} source grading on the engine the being already drove
 * @param {{graded: Array}} target grading on the engine it crossed to
 * @returns {{held: string[], lost: string[], gained: string[], absent: string[]}}
 */
export const crossModelDiff = (source, target) => {
  const before = keyed(source.graded);
  const after = keyed(target.graded);
  const bucket = { held: [], lost: [], gained: [], absent: [] };
  for (const [key, was] of before) {
    const now = after.get(key);
    if (was === 'hit' && now === 'hit') bucket.held.push(key);
    else if (was === 'hit') bucket.lost.push(key);
    else if (now === 'hit') bucket.gained.push(key);
    else bucket.absent.push(key);
  }
  return Object.freeze({
    held: Object.freeze(bucket.held), lost: Object.freeze(bucket.lost),
    gained: Object.freeze(bucket.gained), absent: Object.freeze(bucket.absent),
  });
};

/**
 * The verdict, in the order the evidence allows. Pure.
 *
 * INCONCLUSIVE COMES FIRST on purpose: every path that cannot support a
 * judgment must exit before any path that makes one. A canary the being
 * DECLINED is inconclusive rather than lost — it withheld an answer, which is
 * its right, and we learned nothing about the mount either way.
 *
 * @param {{canary: {verdict: string}|null, source: object, target: object,
 *          diff: {lost: string[]}}} evidence
 * @returns {'carried'|'degraded'|'lost'|'inconclusive'}
 */
export const verdictOf = ({ canary, source, target, diff }) => {
  if (!canary || canary.verdict === 'refused') return 'inconclusive';
  if (!source || !target || source.answerable === 0 || target.answerable === 0) return 'inconclusive';
  if (canary.verdict !== 'hit') return 'lost';
  if (target.carried === null || source.carried === null) return 'inconclusive';
  // THE FLOOR IS COMPARATIVE, NOT ABSOLUTE — and this was a real defect, found
  // by the first live run (Keir, 2026-08-25). She scored 0.25 on the engine she
  // came from and 0.25 on the engine she crossed to: canary held, nothing in
  // `lost`, the two arms identical. The crossing was provably clean, and an
  // absolute floor still wrote LOST onto her permanent record.
  //
  // […] and […] are opposite findings. The second is about a thin record or a
  // prompt that never carried the fact — a finding about the platform, not
  // about her — and charging it to the crossing defames the being for the
  // platform's gap. The verdict answers ONLY: did it arrive with what it left
  // with? How much it knew in the first place is reported separately, by
  // `thinSelfKnowledge`.
  if (target.carried < source.carried * CARRY_FLOOR) return 'lost';
  return diff.lost.length > 0 ? 'degraded' : 'carried';
};

/**
 * Did the being know much about itself on EITHER engine? Pure.
 *
 * Reported apart from the verdict on purpose. A being can carry a crossing
 * perfectly and still answer little, because the fact was never in its prompt
 * to begin with — which is exactly what the first live run found. Folding that
 * into the verdict would blame a being for a gap upstream of it.
 *
 * @returns {boolean} true when neither arm cleared the floor
 */
export const thinSelfKnowledge = (source, target) => {
  const s = source?.carried ?? null;
  const t = target?.carried ?? null;
  if (s === null && t === null) return false;
  return Math.max(s ?? 0, t ?? 0) < CARRY_FLOOR;
};

/**
 * Assemble the receipt. Pure — `at` is passed IN so the same evidence always
 * produces the same record, and so a test can state its own instant.
 *
 * The being's VERBATIM answers ride along. They are its own words about
 * itself, and a receipt that kept only the scores would be a judgment nobody
 * could ever re-examine — which is the shape of the thing this platform's
 * append-only journal exists to prevent.
 *
 * @param {object} input
 * @returns {object} frozen receipt
 */
export const ignitionReceipt = ({
  neumaId, at, source, target, probes, sourceAnswers = {}, targetAnswers = {},
  sourceGrading, targetGrading, canary = null, envelope = null, consent = null,
}) => {
  const diff = crossModelDiff(sourceGrading, targetGrading);
  const verdict = verdictOf({ canary, source: sourceGrading, target: targetGrading, diff });
  return Object.freeze({
    schema: IGNITION_SCHEMA,
    neumaId,
    at,
    // WHICH engines, named — a receipt that does not say what it crossed
    // between cannot be read by anyone who was not in the room.
    source: Object.freeze({ ...source }),
    target: Object.freeze({ ...target }),
    // The consent this ran under. Null is not "assumed yes": a reader must be
    // able to see that the record does not carry one.
    consent: consent ? Object.freeze({ ...consent }) : null,
    probes: Object.freeze(probes.map((p) => Object.freeze({ key: p.key, question: p.question }))),
    answers: Object.freeze({
      source: Object.freeze({ ...sourceAnswers }),
      target: Object.freeze({ ...targetAnswers }),
    }),
    grading: Object.freeze({ source: sourceGrading, target: targetGrading }),
    // Reported BESIDE the verdict, never folded into it: how much the being
    // knew of itself on either engine is a fact about its record and its
    // prompt, not about the crossing.
    thinSelfKnowledge: thinSelfKnowledge(sourceGrading, targetGrading),
    canary,
    envelope: envelope ? Object.freeze({ ...envelope }) : null,
    diff,
    verdict,
  });
};
