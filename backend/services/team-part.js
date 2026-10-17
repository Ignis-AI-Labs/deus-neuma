// team-part.js — ONE member's part, worked to its end: every attempt, and the
// run's RESPONSE when an attempt stops short.
//
// Design note, 2026-10-12, on a run that failed 0 of 6: […] A
// part had one attempt: whatever cut it — a provider error, a blank answer,
// the operator's guidance (which re-started it from nothing) — ended it.
// Here a part works in ITS OWN SITTING from its first attempt (the member
// turn mints it; the run records it), and:
//   - the operator's STEER continues the part with the note — never a
//     restart from zero;
//   - an attempt that FAILS (anything but the operator's STOP) is answered by
//     the run itself: it waits a little — longer each time — and continues
//     the part where it stopped, told why (team-continue.js). Only failures
//     IN A ROW that took no act and said no word count toward giving up: a
//     part doing real work is never abandoned for a hiccup;
//   - an answer that did not FINISH the part (no work product, a named file
//     missing — the run's own check, offered as `verify`) is answered too:
//     the member is told what is missing and continues;
//   - every attempt is LOGGED as it happens (team-part-log.js) — the
//     operator opens it member by member, and a continuation reads the
//     part's own acts back from it;
//   - the run's WIDTH holds a part until it may work (team-run-gate.js), and
//     a CLOCK, when the plan or a hand set one, counts the part's working
//     time and acts when it passes (team-clock.js, #577): it notifies, asks
//     the member to hand in what it has, or stops the part — resumable.
// No clock is the default: nothing caps how long a member works or thinks
// unless someone chose it (Design note, 2026-10-10: […]; 2026-10-13: […]).
//
// impure — runs the member, waits, writes the part's log and the run's frames.

import {
  stepSignal, releaseStep, appendStepStream, recordStepTool, markStepLine, markStepRetry, markStepClock,
  STEER_REASON, STOP_MEMBER_REASON,
} from './team-run-live.js';
import { attemptMessages } from './team-continue.js';
import { createPartLog, actsOfPart } from './team-part-log.js';
import { createRunGate } from './team-run-gate.js';
import { createAttemptClock } from './team-part-clock.js';
import {
  clockFor, workLimitMs, dueAtMs, describeClock, clockBrief, partialBanner, formatMinutes,
  WRAP_UP_GRACE_MS, CLOCK_WRAP_REASON, CLOCK_STOP_REASON,
} from './team-clock.js';

/** Failures in a row — none of them taking an act or saying a word — after which the run stops continuing a part on its own. */
export const AUTO_CONTINUE_MAX = 3;
/** How long the run waits before it continues a part that stopped short: the first time, the second, the third. */
export const AUTO_CONTINUE_WAIT_MS = Object.freeze([10_000, 60_000, 300_000]);
/** How many times an answer that did not finish its part is sent back to finish it. */
export const UNFINISHED_MAX = 2;

// THE OPERATOR'S SLOT HOLDS ACROSS RUNS. A team leaves one slot free per run,
// so two leads' teams at once would take it back (2 × (ceiling − 1)). Every
// member decode in this process takes a slot here first; a member stopped
// while it waits leaves the queue.
const slots = { busy: 0, waiting: [] };

// impure — wait for a member decode slot.
const acquireSlot = (limit, signal) => {
  if (signal.aborted) return Promise.reject(new Error(signal.reason?.message || 'stopped by the operator'));
  if (slots.busy < limit) {
    slots.busy += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      slots.waiting = slots.waiting.filter((w) => w !== waiter);
      reject(new Error(signal.reason?.message || 'stopped by the operator'));
    };
    const waiter = { limit, admit: () => { signal.removeEventListener('abort', onAbort); resolve(); } };
    slots.waiting.push(waiter);
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

// impure — a member's decode ended; the longest-waiting member that fits goes next.
const releaseSlot = () => {
  slots.busy -= 1;
  const next = slots.waiting.findIndex((w) => slots.busy < w.limit);
  if (next === -1) return;
  const [waiter] = slots.waiting.splice(next, 1);
  slots.busy += 1;
  waiter.admit();
};

// impure — the wait before a continuation. STOP (the run or this member) and
// the operator's guidance end it at once; the loop reads which.
const pause = async (entry, stepId, ms) => {
  const signal = stepSignal(entry, stepId);
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  } finally {
    releaseStep(entry, stepId);
  }
};

/**
 * The conduit every part of one run is worked through.
 *
 * @param {Object} args
 * @param {Object} args.entry - the live registry entry (team-run-live.js)
 * @param {Function} args.ask - (neumaId, messages, step, hooks) => Promise<string>
 * @param {number} args.limit - member decodes this process allows at once
 * @param {?Object} [args.record] - the run record keeper (its `sitting` keeps each part's sitting)
 * @param {Object} [args.resumed] - stepId -> why the prior instance stopped, for parts picked up again
 * @param {number[]} [args.waits] - the waits before each continuation (AUTO_CONTINUE_WAIT_MS)
 * @returns {Function} (neumaId, messages, step, hooks) => Promise<string>
 */
export const createPartRunner = ({ entry, ask, limit, record = null, resumed = {}, waits = AUTO_CONTINUE_WAIT_MS }) => async (neumaId, messages, step, hooks) => {
  // The run's own width (#577): every part of the run passes it to work.
  entry.gate ??= createRunGate(entry, { onHeld: (stepId, at) => markStepLine(entry, stepId, { state: 'held', ...at }) });
  const plog = createPartLog({ neumaId, runId: entry.id, stepId: step.id });
  const keepSitting = (sessionId) => {
    if (!sessionId || entry.sessions[step.id] === sessionId) return;
    entry.sessions[step.id] = sessionId;
    record?.sitting?.(step.id, sessionId);
  };
  // A part the prior instance began picks up its own sitting again.
  let continuation = entry.sessions[step.id] ? { kind: 'resumed', why: resumed[step.id] ?? null } : null;
  let quiet = 0; // failures in a row that took no act and said no word
  let unfinished = 0;
  let delivered = 0; // the operator's notes this part has read
  let wrapping = null; // { why, from } once its clock asked the member to hand in what it has
  // What the part's clock allows from here: its whole working budget and its
  // calendar due — none once its clock has acted (a hand's new clock re-arms
  // it); a wrap-up gets its grace of working time, then the part is stopped.
  const limitsNow = () => {
    if (wrapping) return { limitMs: wrapping.from + WRAP_UP_GRACE_MS, dueMs: null };
    const clock = entry.clockState[step.id] ? null : clockFor(entry, step.id);
    return { limitMs: workLimitMs(clock), dueMs: dueAtMs(clock) };
  };
  // THE CLOCK ACTS — once per clock (a hand's new clock is a new one).
  const clockPassed = (by) => {
    const working = entry.steps.get(step.id);
    if (wrapping) {
      working?.abort(new Error(CLOCK_STOP_REASON));
      return;
    }
    const clock = clockFor(entry, step.id);
    if (!clock) return;
    const state = { passed: true, by, at: new Date().toISOString(), then: clock.then, clock: describeClock(clock) };
    entry.clockState[step.id] = state;
    record?.clockPassed?.(step.id, state);
    plog.clock(state);
    markStepClock(entry, step.id);
    entry.onClockPassed?.(step.id, state);
    if (clock.then !== 'notify') working?.abort(new Error(clock.then === 'wrap-up' ? CLOCK_WRAP_REASON : CLOCK_STOP_REASON));
  };
  for (;;) {
    if (entry.controller.signal.aborted) throw new Error('the operator stopped the run');
    if (entry.stopped.has(step.id)) throw new Error(STOP_MEMBER_REASON);
    const signal = stepSignal(entry, step.id);
    const sitting = entry.sessions[step.id] ?? null;
    const inSitting = Boolean(sitting && continuation);
    const notes = entry.notes[step.id] || [];
    // Said once: a continuation in the sitting carries only the notes it has not read.
    const fresh = inSitting ? notes.slice(delivered) : notes;
    delivered = notes.length;
    const acts = continuation ? await plog.settled().then(() => actsOfPart(neumaId, entry.id, step.id)) : [];
    // What the team said while this part was away from its work.
    const posts = continuation ? entry.channel.filter((m) => m.fromStep !== step.id).length : 0;
    const asked = attemptMessages({
      messages, notes: fresh, sitting: inSitting,
      continuation: continuation && { ...continuation, acts, posts, room: entry.room?.root ?? null },
      clock: continuation ? null : clockBrief(clockFor(entry, step.id)),
    });
    plog.begin({ how: continuation?.kind ?? 'brief', why: continuation?.why ?? null, text: asked.at(-1)?.content ?? '' });
    const progress = { acts: 0, words: 0 };
    let gated = false;
    let holding = false;
    let waitMs = 0;
    // This attempt's watch over the part's clock and working time.
    const timer = createAttemptClock({ entry, stepId: step.id, limits: limitsNow(), onPass: clockPassed, keep: record?.worked ?? null });
    entry.clockWatch.set(step.id, () => timer.retarget(limitsNow()));
    try {
      await entry.gate.enter(step.id, signal);
      gated = true;
      await acquireSlot(limit, signal);
      holding = true;
      timer.work();
      delete entry.retries[step.id]; // the wait is over — a late window must not read it as pending
      const answer = await ask(neumaId, asked, step, {
        ...(hooks || {}),
        signal,
        sessionId: sitting,
        // The member's seat in its run: the team channel is its to speak in.
        teamRun: { runId: entry.id, stepId: step.id },
        // The operator watches the member think and speak as it happens; the
        // part's log keeps it.
        onText: (delta) => { progress.words += delta.length; plog.words(delta); appendStepStream(entry, step.id, 'text', delta); },
        onReasoning: (delta) => { plog.thought(delta); appendStepStream(entry, step.id, 'thought', delta); },
        onTool: (event) => {
          if (event?.status !== 'executing') progress.acts += 1;
          plog.act(event);
          recordStepTool(entry, step.id, event);
        },
        onSession: keepSitting,
        // Waiting its turn in the line is never working time.
        onLine: (state) => {
          if (state?.state === 'waiting') timer.pause();
          else timer.work();
          plog.line(state);
          markStepLine(entry, step.id, state);
        },
      });
      if (wrapping) {
        // Handed in at its clock's end: the part stands PARTIAL — every reader downstream is told.
        plog.end({ outcome: 'answered', why: `handed in at its clock's end (${wrapping.why})` });
        entry.answered.add(step.id);
        return `${partialBanner(wrapping.why)}\n\n${answer}`;
      }
      const missing = typeof hooks?.verify === 'function' ? await hooks.verify(answer) : null;
      if (missing && unfinished < UNFINISHED_MAX) {
        unfinished += 1;
        plog.end({ outcome: 'unfinished', why: missing });
        markStepRetry(entry, step.id, { kind: 'unfinished', why: missing, inMs: 0 });
        continuation = { kind: 'unfinished', why: missing };
        continue;
      }
      plog.end({ outcome: 'answered' });
      // The member has answered: a note filed from here on could never reach
      // this part, so the registry refuses it rather than drop it.
      entry.answered.add(step.id);
      return answer;
    } catch (err) {
      if (signal.aborted) {
        const stopped = entry.controller.signal.aborted || entry.stopped.has(step.id);
        const cut = signal.reason?.message;
        if (cut === STEER_REASON && !stopped) {
          plog.end({ outcome: 'steered' });
          appendStepStream(entry, step.id, 'text', '\n— guided: continuing with the operator\'s note —\n');
          continuation = wrapping ? { kind: 'wrap-up', why: wrapping.why } : { kind: 'steered' };
          continue;
        }
        if (cut === CLOCK_WRAP_REASON && !stopped) {
          // Its clock ran out: the member hands in what it has, in its own sitting.
          timer.end();
          const why = entry.clockState[step.id]?.clock || 'its clock';
          plog.end({ outcome: 'wrap-up', why });
          appendStepStream(entry, step.id, 'text', '\n— its clock ran out: handing in what it has —\n');
          wrapping = { why, from: entry.worked[step.id] || 0 };
          continuation = { kind: 'wrap-up', why };
          continue;
        }
        if (cut === CLOCK_STOP_REASON && !stopped) {
          const why = wrapping
            ? `its clock ran out (${wrapping.why}) and it did not hand in within ${formatMinutes(WRAP_UP_GRACE_MS / 60_000)} of work — stopped where it stands; resume the run to continue it`
            : `its clock ran out (${entry.clockState[step.id]?.clock || 'its clock'}) — stopped where it stands; resume the run to continue it`;
          plog.end({ outcome: 'stopped', why });
          throw new Error(why, { cause: err });
        }
        const reason = entry.stopped.has(step.id) ? STOP_MEMBER_REASON : cut || 'stopped by the operator';
        plog.end({ outcome: 'stopped', why: reason });
        throw new Error(reason, { cause: err });
      }
      // THE RESPONSE: the run answers an attempt that stopped short.
      const why = err?.message || String(err);
      quiet = progress.acts || progress.words ? 1 : quiet + 1;
      plog.end({ outcome: 'failed', why });
      if (quiet > AUTO_CONTINUE_MAX) {
        entry.onPartGaveUp?.(step.id, why); // the eye: the operator and the CoS hear it now
        throw err;
      }
      waitMs = waits[Math.min(quiet, waits.length) - 1];
      plog.retry({ inMs: waitMs, why });
      markStepRetry(entry, step.id, { kind: 'failed', why, inMs: waitMs });
      // A part handing in at its clock's end keeps being asked to hand in.
      continuation = wrapping ? { kind: 'wrap-up', why: wrapping.why } : { kind: 'failed', why };
    } finally {
      timer.end();
      entry.clockWatch.delete(step.id);
      if (holding) releaseSlot();
      if (gated) entry.gate.leave();
      releaseStep(entry, step.id);
      delete entry.lines[step.id]; // out of the line, however the attempt ended
    }
    // The slot is free while the part waits — another member works meanwhile.
    if (waitMs) await pause(entry, step.id, waitMs);
  }
};
