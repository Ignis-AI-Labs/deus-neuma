// Terminal portal adapter — the CLI sink for portal frames.
//
// Extracted VERBATIM from cli/commands/agent.js (2026-08-28, neuma-cli-coding-harness)
// so both the one-shot agent seat and the interactive `neuma code` harness
// render the real consciousness path identically. The stream/tool paths are
// unchanged; this is their production CLI sink, replacing only the desk
// renderer.
//
// Direction law: this module imports nothing from the command files it
// serves. Speech owns stdout; tool acts, approval asks, and run metadata go
// to stderr. Exit-code and receipt concerns stay with the callers.

import readline from 'node:readline';

/** Classify one frame emitted by the real consciousness path. Pure. */
export const classifyFrame = (raw) => {
  let frame;
  try { frame = JSON.parse(raw); } catch { return { kind: 'other' }; }
  if (frame?.type === 'tool:approval_request' && frame.id) {
    const args = typeof frame.args === 'string' ? frame.args : JSON.stringify(frame.args ?? {});
    return { kind: 'approval', id: frame.id, tool: String(frame.tool || '?'), args };
  }
  if (frame?.type === 'consciousness:stream' && typeof frame.content === 'string') {
    return { kind: 'speech', content: frame.content, error: frame.error === true };
  }
  if (frame?.type === 'tool:usage' && frame.tool) {
    return {
      kind: 'tool',
      tool: String(frame.tool),
      status: String(frame.status || '?'),
      summary: String(frame.summary || frame.detail || ''),
    };
  }
  if (frame?.type === 'consciousness:provider-retry') {
    return { kind: 'retry', attempt: frame.attempt, maxAttempts: frame.maxAttempts };
  }
  if (frame?.type === 'context:composition' && frame.usage
    && Number.isFinite(frame.usage.outputTokens)) {
    return {
      kind: 'usage',
      inputTokens: Number.isFinite(frame.usage.inputTokens) ? frame.usage.inputTokens : null,
      outputTokens: Number.isFinite(frame.usage.outputTokens) ? frame.usage.outputTokens : null,
      source: String(frame.usage.source || 'unknown'),
    };
  }
  if (frame?.type === 'operator:ask' && frame.id) {
    const questions = Array.isArray(frame.questions) && frame.questions.length
      ? frame.questions : [{ question: String(frame.question || ''), options: (frame.options || []).map((label) => ({ label })) }];
    return { kind: 'ask', id: frame.id, questions };
  }
  if (frame?.type === 'consciousness:complete') {
    return { kind: 'complete', sessionId: frame.sessionId || null };
  }
  return { kind: 'other' };
};

/** Add one model round without inventing totals when any round is unmeasured. Pure. */
export const addAgentRoundUsage = (total, round) => {
  if (!total) {
    return Object.freeze({
      inputTokens: round.inputTokens,
      outputTokens: round.outputTokens,
      rounds: 1,
      source: round.source,
    });
  }
  return Object.freeze({
    inputTokens: Number.isFinite(total.inputTokens) && Number.isFinite(round.inputTokens)
      ? total.inputTokens + round.inputTokens : null,
    outputTokens: Number.isFinite(total.outputTokens) && Number.isFinite(round.outputTokens)
      ? total.outputTokens + round.outputTokens : null,
    rounds: total.rounds + 1,
    source: total.source === round.source ? total.source : 'mixed',
  });
};

/** A real timer that aborts the supplied target when its budget is spent. */
export const startWallClock = (seconds, target) => {
  let tripped = false;
  const timer = setTimeout(() => { tripped = true; target.abort(); }, seconds * 1000);
  return { cancel: () => clearTimeout(timer), tripped: () => tripped };
};

// impure — one y/n at the terminal; anything other than yes is denial.
const askTerminal = (stdin, stderr, question) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: stdin, output: stderr });
  rl.question(question, (answer) => {
    rl.close();
    resolve(/^y(es)?$/i.test(String(answer || '').trim()) ? 'allow' : 'deny');
  });
});

// impure — put an operator ask to the terminal, one question at a time.
const askQuestions = async (stdin, stderr, questions) => {
  const answers = [];
  for (const q of questions) {
    const options = (q.options || []).map((o, i) => `  ${i + 1}. ${o.label}`).join('\n');
    const rl = readline.createInterface({ input: stdin, output: stderr });
    const answer = await new Promise((resolve) => rl.question(`\n${q.question}\n${options}${options ? '\n' : ''}> `, resolve));
    rl.close();
    const picked = (q.options || [])[Number(String(answer).trim()) - 1];
    answers.push(picked ? picked.label : String(answer || '').trim());
  }
  return answers;
};

// impure — answer an operator ask. With no terminal nobody can: the ask
// settles at once as ABSENT and the being is told to decide and deliver,
// instead of parking on a card until the wall clock kills the sitting.
const answerAsk = async ({ stdin, stderr, connection, frame }) => {
  const { resolveOperatorAsk, settleOperatorAsk } = await import('../../backend/services/operator-ask.js');
  if (!stdin.isTTY) {
    stderr.write('  · ask unanswerable (no operator in this sitting) — the being decides\n');
    settleOperatorAsk(connection, frame.id, 'absent');
    return;
  }
  const answers = await askQuestions(stdin, stderr, frame.questions);
  if (!resolveOperatorAsk(connection, frame.id, null, answers)) settleOperatorAsk(connection, frame.id, 'absent');
};

/**
 * Terminal adapter for portal frames. `resolveToolApproval(connection, id,
 * decision)` answers an ACTS ask; the REPL passes its pause/resume hooks so
 * the prompt does not fight an in-flight approval question.
 */
/**
 * @param {object} args
 * @param {boolean} [args.finalRoundOnly] a benchmark sitting: stdout carries only
 *   the turn's FINAL words. Speech before a tool act is a working note and goes
 *   to stderr. SciCode, 2026-10-03: 30 of 60 agent answers opened with narration
 *   spoken before a verifying tool call ([…]); it
 *   was glued onto the code, so the code failed with a SyntaxError and the next
 *   step built on it failed too. Bare, which has no tools, never narrates. The
 *   being is told after every tool round that its final answer is exactly the
 *   task's form (RESULTS_FOLLOW_UP); this makes the seat deliver what it is told.
 */
export const createCliPortal = ({ stdin, stdout, stderr, connection, resolveToolApproval, finalRoundOnly = false }) => {
  const state = {
    acts: 0,
    completed: false,
    errored: false,
    errorText: null,
    sessionId: null,
    latestRoundUsage: null,
    totalUsage: null,
    speechOpen: false,
    speechEndsWithNewline: true,
  };
  let held = '';
  const emit = (text) => {
    stdout.write(text);
    state.speechOpen = true;
    state.speechEndsWithNewline = text.endsWith('\n');
  };
  const finishSpeech = () => {
    if (held) { emit(held); held = ''; }
    if (state.speechOpen && !state.speechEndsWithNewline) stdout.write('\n');
    state.speechOpen = false;
  };
  return {
    readyState: 1,
    OPEN: 1,
    state,
    finishSpeech,
    send(raw) {
      const frame = classifyFrame(raw);
      if (frame.kind === 'speech') {
        if (finalRoundOnly) held += frame.content;
        else emit(frame.content);
        state.errored ||= frame.error;
        // THE FAILURE REASON (#506 N3): an error-flagged speech frame is the
        // wire's own account of what went wrong. It still owns stdout (the
        // speech channel is the machine contract), but it is no longer lost
        // there — the caller's non-zero exit needs it for stderr and the
        // receipt (the request-24 crash printed nothing but its banner).
        if (frame.error) {
          state.errorText = state.errorText === null
            ? frame.content
            : `${state.errorText}\n${frame.content}`;
        }
        return;
      }
      if (frame.kind === 'tool') {
        if (frame.status !== 'executing') state.acts += 1;
        // Words spoken before an act are a working note, never the answer.
        if (finalRoundOnly && held.trim()) stderr.write(`  · note: ${held.trim().slice(0, 300)}\n`);
        if (finalRoundOnly) held = '';
        stderr.write(`  ${frame.status === 'executing' ? '→' : '·'} ${frame.status}  ${frame.tool}${frame.summary ? ` — ${frame.summary.slice(0, 160)}` : ''}\n`);
        return;
      }
      if (frame.kind === 'usage') {
        state.latestRoundUsage = frame;
        state.totalUsage = addAgentRoundUsage(state.totalUsage, frame);
        return;
      }
      if (frame.kind === 'retry') {
        stderr.write(`  ↻ provider retry ${frame.attempt}/${frame.maxAttempts}\n`);
        return;
      }
      if (frame.kind === 'complete') {
        finishSpeech();
        state.completed = true;
        state.sessionId = frame.sessionId;
        return;
      }
      if (frame.kind === 'ask') {
        answerAsk({ stdin, stderr, connection, frame }).catch((error) => {
          stderr.write(`  · ask failed — ${error.message}\n`);
        });
        return;
      }
      if (frame.kind !== 'approval') return;
      if (!stdin.isTTY) {
        stderr.write(`  · approval refused (no terminal to ask): ${frame.tool}\n`);
        resolveToolApproval(connection, frame.id, 'deny');
        return;
      }
      stderr.write(`\napproval requested: ${frame.tool}\n${frame.args}\n`);
      askTerminal(stdin, stderr, `allow ${frame.tool}? [y/N] `)
        .then((decision) => resolveToolApproval(connection, frame.id, decision));
    },
  };
};
