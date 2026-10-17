/** Pure thinking translation; time and current take are supplied by the host. */
export const thinkingActions = (data, currentTake, at) => {
  if (typeof data?.content !== 'string' || !data.content) return [];
  const take = data.turnId ? { turnId: data.turnId, takeIndex: data.takeIndex } : currentTake;
  return [
    ...(data.turnId ? [{ type: 'TURN_STAMP', turnId: data.turnId }] : []),
    { type: 'THINKING', text: data.content, at, take },
  ];
};

/** Pure speech decisions; stamp/start precede the host's error-flush boundary. */
export const speechActions = (data, { seen, witness }) => {
  const first = !seen;
  const error = Boolean(data.error);
  const health = error
    ? (witness ? (data.provider ? { type: 'ROUTE', live: false, provider: data.provider } : null)
      : { type: 'LOCAL', reachable: false, standby: false })
    : (first ? (witness ? { type: 'ROUTE', live: true } : { type: 'LOCAL', reachable: true, standby: false }) : null);
  return {
    first, error, health,
    take: data.turnId ? { turnId: data.turnId, takeIndex: data.takeIndex } : null,
    stamp: data.turnId && first ? { type: 'TURN_STAMP', turnId: data.turnId } : null,
    start: first ? { type: 'STREAM' } : null,
    failure: error ? { type: 'ERROR', text: data.content || data.thought || 'Connection disrupted', turnId: data.turnId } : null,
    content: data.content || data.thought || data.chunk || '',
  };
};

/** Pure completion translation, including turns which never emitted speech. */
export const completionActions = (data) => [
  ...(data?.turnId ? [{ type: 'TURN_STAMP', turnId: data.turnId }] : []),
  { type: 'COMPLETE', metadata: data?.metadata || null },
];

/** Pure provider retry note with an explicit clock input. */
export const providerRetryAction = (data, at) => ({
  type: 'PROVIDER_RETRY',
  attempt: Number(data?.attempt) || 0,
  maxAttempts: Number(data?.maxAttempts) || 0,
  delayMs: Number(data?.delayMs) || 0,
  reason: typeof data?.reason === 'string' ? data.reason : '',
  at,
});

/**
 * The house's line, visible (substrate-line.js; Design note, 2026-10-12: […]). Pure, with an explicit clock input.
 * @param {{state?: string, position?: number, ahead?: Array<{label?: string, kind?: string}>}} data
 * @param {number} at
 */
export const substrateLineAction = (data, at) => ({
  type: 'SUBSTRATE_LINE',
  state: data?.state === 'waiting' ? 'waiting' : 'done',
  position: Number(data?.position) || 0,
  ahead: Array.isArray(data?.ahead) ? data.ahead.map((a) => String(a?.label || 'a chat')) : [],
  at,
});

/**
 * The waiting line's words: who is ahead, never a bare "busy". Pure.
 * @param {{ahead: string[]}} action
 * @returns {string}
 */
export const substrateLineText = ({ ahead }) => {
  const shown = ahead.slice(0, 4).join(', ');
  const more = ahead.length > 4 ? ` +${ahead.length - 4} more` : '';
  return ahead.length
    ? `waiting its turn for the model — ahead: ${shown}${more}`
    : 'waiting its turn for the model';
};

