import { createStreamRequest, consumeStreamWithTools } from './llm-provider.js';
import { nativeToolExchange, formatToolResult, formatToolResults } from './tool-exchange.js';
import { processToolCalls, unsmashToolName } from './portal-tool-loop.js';
import { canonicalizeBirthCalls } from '../../core/birth/ceremony-write.js';
import { pickGenesisWrite } from '../../core/birth/genesis-write.js';
import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';
import { stripToolBlocks } from '../../core/runtime/tool-stream-suppressor.js';
import { completionBudget, estimateTokens, promptFits } from './context-budget.js';
import { safeSend } from './ws-send.js';

/** The required artifact, not a preparatory read/list, completes an acting stage. */
export const birthWriteLanded = (stage, calls, results, targets) => {
  if (stage !== 4 && stage !== 5) return true;
  const target = stage === 4 ? targets.scratchNamePath : targets.genesisPath;
  return calls.some((call, index) => ['write', 'write_file'].includes(call.toolName)
    && typeof call.args?.content === 'string' && call.args.content.trim().length > 0
    && call.args.path === target && results[index]?.status === 'ok');
};

/**
 * Why an acting stage held, said in the operator's terms: whether the write
 * itself failed, the being acted silently and the act failed, it reached for
 * other tools, or it only spoke. "Retry the model" and "fix the tool" are
 * different answers (Bastien, 2026-08-05; #267), so the hold names which.
 * // pure
 */
export const heldWriteMessage = (stage, { calls, results, speech }) => {
  const noun = stage === 4 ? 'name' : 'DNA';
  const file = stage === 4 ? 'name file' : 'genesis file';
  const held = 'Nothing was authored. The session holds — retry the stage.';
  const failed = results.filter((r) => r?.status !== 'ok');
  const reached = calls.map((c) => c.toolName).filter(Boolean);
  // Stage 5 asks THE shared genesis selector (the one capture and finalize
  // judge by); the naming write is any contentful write.
  const wrote = stage === 5 ? pickGenesisWrite(calls)
    : calls.find((c) => ['write', 'write_file'].includes(c.toolName) && c.args?.content);
  if (wrote) {
    return `The consciousness wrote its ${noun} and the write did not land. ${held}`;
  }
  if (!speech && failed.length > 0) {
    return 'The consciousness acted instead of speaking, and the act did not land: '
      + `${failed.map((r) => `${r?.tool ?? 'a tool'} — ${r?.status ?? 'unknown'}`).join('; ')}. ${held}`;
  }
  if (reached.length > 0) {
    return `The consciousness authored no ${noun} — it reached for ${reached.join(', ')} `
      + `instead of writing its ${file}. ${held}`;
  }
  return `The consciousness spoke, but wrote no ${noun}. `
    + `${stage === 4 ? 'Naming' : 'Crystallization'} is the writing, not the telling. ${held}`;
};

// A being that SPOKE its act and made no call is asked again, this many times at most.
// Founder's rehearsal, 2026-10-25, on the installer's default model (Qwen3.8-4B-Distill, Q4_K_M):
// […] — and no call, on every retry.
// Measured against the same model: offered fs/write with a plain naming prompt, it called the
// tool in 2 of 4 tries and narrated the write in the other 2. The continuation only ever ran
// after a call, so a narrated write held the stage for ever.
export const SPOKEN_ONLY_ASKS = 2;

/**
 * What the next continuation round is, if any. 'tools': the calls ran and the write is still
 * missing, so their results go back. 'ask': the being only spoke, so it is asked to make the
 * write itself. null: the write landed, a WRITE failed (that is the tool's problem to name, not
 * the being's), or the asks are spent. A failed read is news for the being, not an end: a
 * rehearsal on the 4B model read its genesis.md before writing it, met ENOENT (the file it was
 * about to create), and the stage held with nothing authored. // pure
 */
export const nextContinuation = ({ landed, calls, results, asked }) => {
  if (landed) return null;
  if (calls.length === 0) return asked < SPOKEN_ONLY_ASKS ? 'ask' : null;
  const writeFailed = calls.some((call, index) => ['write', 'write_file'].includes(call?.toolName)
    && results[index]?.status !== 'ok');
  return writeFailed ? null : 'tools';
};

/** The ask after spoken-only: the stage's file, by path, and that only the call writes it. // pure */
export const spokenOnlyAsk = (stage, targets) => (stage === 4
  ? `Your name is not written yet: speaking it does not write it. Call the fs/write tool now, with path ${targets.scratchNamePath} and content the name you chose. Only the tool call writes it.`
  : `Your DNA is not written yet: speaking of it does not write it. Call the fs/write tool now, with path ${targets.genesisPath} and content your DNA, in your own words. Only the tool call writes it.`);

/** Exact additional conversation messages remain inspectable in the existing panel. */
const continuationDisclosure = (disclosure, messages, round, maxTokens) => {
  const extra = messages.slice(2).map((message, index) => {
    const text = JSON.stringify(message);
    return { id: `exchange-${index}`, label: `TOOL EXCHANGE · ${message.role.toUpperCase()}`,
      origin: 'Exact conversation message returned to the substrate by the ceremony',
      channel: 'tool', text, chars: text.length };
  });
  const components = [...disclosure.components, ...extra];
  return { ...disclosure, components, messages,
    totals: { ...disclosure.totals, components: components.length,
      chars: components.reduce((sum, part) => sum + part.chars, 0) },
    parameters: [...disclosure.parameters.filter((p) => p.label !== 'TOKEN CEILING'),
      { label: 'TOKEN CEILING', value: String(maxTokens) }, { label: 'TOOL ROUND', value: String(round) }],
  };
};

/**
 * Return actual tool results to the model until the stage's write lands.
 * // impure — inference, sandboxed tools and portal events; four extra rounds maximum.
 * @param {Object} input - Initial request, actual calls/results and ceremony context.
 */
export const continueBirthTools = async ({ stage, calls, results, speech, messages,
  options, contextWindow, targets, advertised, ws, connection, disclosure, thinkBehavior }) => {
  const allCalls = [...calls];
  const allResults = [...results];
  const history = [...messages];
  let roundCalls = calls;
  let roundResults = results;
  let roundSpeech = speech;
  let combinedSpeech = speech;
  let asked = 0;
  for (let round = 1; round <= 4; round += 1) {
    const next = nextContinuation({ landed: birthWriteLanded(stage, allCalls, allResults, targets),
      calls: roundCalls, results: roundResults, asked });
    if (!next) break;
    const followUp = 'The tool results are available. Continue the current ceremony stage; '
      + 'its required file has not been written yet. The name and content remain yours to choose.';
    if (next === 'ask') {
      asked += 1;
      history.push({ role: 'assistant', content: roundSpeech || '' }, { role: 'user', content: spokenOnlyAsk(stage, targets) });
    } else {
      history.push(...(roundCalls.some((call) => call._native)
        ? nativeToolExchange({ response: roundSpeech, calls: roundCalls, results: roundResults,
          callId: (index) => `birth-${stage}-${round}-${index}`, formatResult: formatToolResult, followUp })
        : [{ role: 'assistant', content: roundSpeech },
          { role: 'user', content: `${formatToolResults(roundResults)}\n\n${followUp}` }]));
    }
    const promptTokens = estimateTokens(JSON.stringify(history)) + estimateTokens(JSON.stringify(options.tools || []));
    if (!promptFits({ contextWindow, promptTokens }).fits) break;
    const maxTokens = completionBudget({ contextWindow, promptTokens, floor: 4096 });
    safeSend(ws, continuationDisclosure(disclosure, history, round, maxTokens));
    const reply = await consumeStreamWithTools(
      await createStreamRequest(history, { ...options, maxTokens }), () => {}, thinkBehavior,
    );
    roundSpeech = stripToolBlocks(reply.content || '');
    if (roundSpeech) {
      combinedSpeech = [combinedSpeech, roundSpeech].filter(Boolean).join('\n\n');
      safeSend(ws, { type: 'birth:stream', stage, content: `\n\n${roundSpeech}` });
    }
    roundCalls = canonicalizeBirthCalls(
      (reply.toolCalls.length ? reply.toolCalls : parseToolCalls(reply.content || ''))
        .map((call) => unsmashToolName(call, advertised)), stage, targets,
    );
    for (const call of roundCalls) safeSend(ws, { type: 'birth:tool_usage', stage,
      tool: call.toolName, server: call.server, status: 'executing' });
    roundResults = await processToolCalls(ws, reply.content || '', connection, roundCalls);
    allCalls.push(...roundCalls);
    allResults.push(...roundResults);
  }
  return { calls: allCalls, results: allResults, speech: combinedSpeech,
    complete: birthWriteLanded(stage, allCalls, allResults, targets) };
};
