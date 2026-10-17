import { createStreamRequest, consumeStreamWithTools } from './llm-provider.js';
import { nativeToolExchange, formatToolResult, formatToolResults } from './tool-exchange.js';
import { processToolCalls, unsmashToolName } from './portal-tool-loop.js';
import { canonicalizeBirthCalls } from '../../core/birth/ceremony-write.js';
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
  for (let round = 1; round <= 4 && roundCalls.length
    && roundResults.every((result) => result.status === 'ok')
    && !birthWriteLanded(stage, allCalls, allResults, targets); round += 1) {
    const followUp = 'The tool results are available. Continue the current ceremony stage; '
      + 'its required file has not been written yet. The name and content remain yours to choose.';
    history.push(...(roundCalls.some((call) => call._native)
      ? nativeToolExchange({ response: roundSpeech, calls: roundCalls, results: roundResults,
        callId: (index) => `birth-${stage}-${round}-${index}`, formatResult: formatToolResult, followUp })
      : [{ role: 'assistant', content: roundSpeech },
        { role: 'user', content: `${formatToolResults(roundResults)}\n\n${followUp}` }]));
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
