// THE LINE'S TWO ACTS, judged — handing a stage's work on, and answering an
// inspection — plus whose move the line waits on. The beings' intents
// (intents/company-acts.js) and the operator's routes share this one law, so
// a desk press and a filed act can never disagree about who may do what.
// An actor is a lane id, or 'operator'.
//
// THE OPERATOR'S OWN YES (Design note, 2026-10-30: nothing is approved twice): when the
// operator masters a stage and the look that follows would be their own too
// (the Rector-operator's CHOOSE, the floor's one yes or no on the company they
// will own), handing it on IS that yes, and ending the gap is the no, offered
// on the same screen. Counsel's answer is never folded (it is the lawyer's,
// carried back), and a being's inspection always stands.
// PURE: the line (line-state.js), the holders (stage-holders.js) and the
// dial stop come in as data.

import { inspectionsFor, masterFor, inspectorFor } from './inspection-chain.js';
import { advance } from './line-state.js';

export const VERDICTS = Object.freeze(['accept', 'return', 'stop']);
export const ARTIFACT_MAX = 300;
export const NOTE_MAX = 2000;

const refuse = (status, reason) => ({ ok: false, status, reason });

// pure — one bounded paragraph, or '' for none.
const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const holderOf = (who) => (who.by === 'operator' ? 'operator' : who.laneId);
const seatWords = (seat) => (seat === 'operator' ? 'the operator' : `the ${seat}`);

/**
 * Whose move the line waits on: the stage's master (open or returned work),
 * the inspector of the current step, nobody yet (the master's seat is empty),
 * or nothing (the line stands complete). pure.
 * @param {object} line - foldLine's state
 * @param {Record<string, string>} holders
 * @returns {{kind: 'master'|'inspector'|'unheld'|'standing', holder?: string, seat?: string, as?: string}}
 */
export const whoIsUp = (line, holders) => {
  if (line.status === 'standing' || !line.stage) return { kind: 'standing' };
  if (line.status === 'inspecting') {
    const who = inspectorFor(line.handed.inspections[line.step], { holders, doer: line.handed.by });
    return { kind: 'inspector', holder: holderOf(who), seat: who.by === 'operator' ? 'operator' : who.seat, as: who.by === 'operator' ? who.as : who.seat };
  }
  const master = masterFor(line.stage, holders);
  if (!master) return { kind: 'unheld', seat: line.stage.master };
  return { kind: 'master', holder: holderOf(master), seat: master.by === 'operator' ? 'operator' : master.seat };
};

// pure — the refusal when the filing names a stage the line is not at.
const stageRefusal = (line, stageId) => (line.status === 'standing' || !line.stage
  ? refuse('invalid', 'this company\'s founding line is complete — the company stands')
  : stageId !== line.stage.id
    ? refuse('invalid', `the line stands at ${line.stage.name} ("${line.stage.id}") — "${stageId ?? ''}" is not the stage in hand`)
    : null);

/**
 * May this actor hand this stage's work on, now? pure.
 * @param {{line: object, holders: Record<string, string>, stop: string, actor: string, stageId: string,
 *   artifact: unknown, note: unknown, now: string}} args
 * @returns {{ok: true, event: object} | {ok: false, status: string, reason: string}}
 */
export const judgeHandOn = ({ line, holders, stop, actor, stageId, artifact, note, now }) => {
  const off = stageRefusal(line, stageId);
  if (off) return off;
  const { stage } = line;
  if (line.status === 'inspecting') return refuse('invalid', `${stage.name} is already handed on and under inspection`);
  const up = whoIsUp(line, holders);
  if (up.kind === 'unheld') return refuse('denied', `nobody holds the ${stage.master} seat, so ${stage.name} stands open until it is held`);
  if (up.holder !== actor) return refuse('denied', `${stage.name} is ${seatWords(up.seat)}'s stage to master — pass your part to them by house post`);
  const where = clean(artifact, ARTIFACT_MAX);
  if (!where) return refuse('invalid', 'hand on {artifact}: where the work lies — a path on the house ground, or a link');
  return {
    ok: true,
    event: { type: 'handed', stage: stage.id, by: actor, artifact: where, note: clean(note, NOTE_MAX) || null, inspections: inspectionsFor(stage, stop, holders), at: now },
  };
};

/**
 * May this actor answer the inspection the line waits on, with this verdict? pure.
 * @param {{line: object, holders: Record<string, string>, actor: string, stageId: string,
 *   verdict: unknown, flaw: unknown, now: string}} args
 * @returns {{ok: true, event: object} | {ok: false, status: string, reason: string}}
 */
export const judgeInspect = ({ line, holders, actor, stageId, verdict, flaw, now }) => {
  const off = stageRefusal(line, stageId);
  if (off) return off;
  const { stage } = line;
  if (line.status !== 'inspecting') {
    return refuse('invalid', `${stage.name} is not under inspection — ${line.status === 'returned' ? 'it went back to its master to mend' : 'its master has not handed it on yet'}`);
  }
  const up = whoIsUp(line, holders);
  if (up.holder !== actor) return refuse('denied', `this inspection of ${stage.name} is ${seatWords(up.seat)}'s to answer`);
  if (!VERDICTS.includes(verdict)) return refuse('invalid', `a verdict is one of ${VERDICTS.join(', ')}`);
  if (verdict === 'stop' && !stage.stoppable) return refuse('invalid', `${stage.name} cannot end the gap — accept it, or return it with the flaw named`);
  const named = clean(flaw, NOTE_MAX);
  if (verdict !== 'accept' && !named) return refuse('invalid', `name the flaw — ${verdict === 'stop' ? 'why this gap ends here' : 'what is wrong, so its master can mend it'}`);
  return {
    ok: true,
    event: { type: 'inspected', stage: stage.id, step: line.step, verdict, by: actor, as: up.as, flaw: named || null, at: now },
  };
};

/**
 * Is the operator's hand-on here their own yes? They master the stage in hand
 * and its first look would fall to them as well (never counsel's). pure.
 * @param {object} line - foldLine's state
 * @param {Record<string, string>} holders
 */
export const ownYesAt = (line, holders) => {
  if (!line.stage || !['open', 'returned'].includes(line.status)) return false;
  if (masterFor(line.stage, holders)?.by !== 'operator') return false;
  const first = inspectorFor(line.stage.inspectors[0], { holders, doer: 'operator' });
  return first.by === 'operator' && first.as !== 'counsel';
};

/**
 * The events a judged move lands: the move itself, and — when it is the
 * operator's own hand-on — every look that then waits on the operator alone,
 * answered by that hand-on. The run ends at the first look that is anyone
 * else's (a being's, or counsel's). pure.
 * @param {{line: object, holders: Record<string, string>, event: object, now: string}} args - the line before the move
 * @returns {Array<object>}
 */
export const withOwnAnswers = ({ line, holders, event, now }) => {
  if (event.type !== 'handed' || event.by !== 'operator') return [event];
  const run = [event];
  for (let at = advance(line, event); at.status === 'inspecting';) {
    const up = whoIsUp(at, holders);
    if (up.holder !== 'operator' || up.as === 'counsel') break;
    const yes = { type: 'inspected', stage: at.stage.id, step: at.step, verdict: 'accept', by: 'operator', as: up.as, flaw: null, own: true, at: now };
    run.push(yes);
    at = advance(at, yes);
  }
  return run;
};

/**
 * The operator's no where their hand-on would be their yes (ownYesAt): the
 * gap ends here with its reason named, and the next round opens at SURVEY.
 * Recorded as a stop always reads — the stage handed on with no work, and the
 * operator's stop on it. pure.
 * @param {{line: object, holders: Record<string, string>, stop: string, actor: string, stageId: string, flaw: unknown, now: string}} args
 * @returns {{ok: true, events: Array<object>} | {ok: false, status: string, reason: string}}
 */
export const judgeEndGap = ({ line, holders, stop, actor, stageId, flaw, now }) => {
  const off = stageRefusal(line, stageId);
  if (off) return off;
  const { stage } = line;
  if (!stage.stoppable) return refuse('invalid', `${stage.name} cannot end the gap — hand its work on, or leave it with its master`);
  if (actor !== 'operator' || !ownYesAt(line, holders)) {
    return refuse('denied', `the gap ends at ${stage.name} by its inspection's answer — its master hands the work on, and the inspector says no`);
  }
  const named = clean(flaw, NOTE_MAX);
  if (!named) return refuse('invalid', 'name why this gap ends here');
  const inspections = inspectionsFor(stage, stop, holders);
  const { as } = inspectorFor(inspections[0], { holders, doer: 'operator' });
  return {
    ok: true,
    events: [
      { type: 'handed', stage: stage.id, by: 'operator', artifact: 'no gap chosen — the operator ended it here', note: null, inspections, at: now },
      { type: 'inspected', stage: stage.id, step: 0, verdict: 'stop', by: 'operator', as, flaw: named, at: now },
    ],
  };
};
