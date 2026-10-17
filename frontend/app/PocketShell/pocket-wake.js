// pocket-wake — when a phone must not sleep on the being.
//
// A phone's screen times out seconds after the operator sends, and the sleep
// kills the socket: the being's frames go to a dead connection and an
// approval card raised on it is denied before the operator sees it (Corwin,
// 2026-09-07, every run). While the being is working for this surface, or
// waiting on this surface's answer, the screen is held awake. An idle chat
// sleeps as it always did.
//
// Pure: the decision. The hook beside it holds the lock.

/**
 * @param {{ thinking?: boolean, messages?: readonly { streaming?: boolean, segments?: readonly { kind?: string, phase?: string }[] }[] }} state
 * @returns {boolean}
 */
export const wantsWakeLock = ({ thinking = false, messages = [] } = {}) =>
  thinking === true
  || messages.some((m) => m?.streaming === true
    || (Array.isArray(m?.segments) && m.segments.some((s) => s?.kind === 'approval' && s?.phase === 'pending')));
