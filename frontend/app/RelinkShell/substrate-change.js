// substrate-change.js — one desk-wide pulse when the loaded weights change.
//
// Stream and SUBSTRATE both mount a ModelBar. An ignite started on one must
// land on the other — same loaded row, no stale LOADED mark.

const EVENT = 'neuma:substrate-change';

/** impure — tell every bar the rig's loaded weights just moved. */
export const announceSubstrateChange = (kind = 'change') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { kind } }));
};

/**
 * Subscribe to a loaded-weights change. Returns the unsubscribe.
 * impure
 * @param {(detail: {kind?: string}) => void} fn
 */
export const onSubstrateChange = (fn) => {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => fn(event.detail || {});
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
};
