// loading-states.js — visible transition helpers
//
// Pure DOM factories + a singleton status indicator. Every place that
// previously had a blank gap now gets one of these while the real UI
// catches up. The witness always sees something breathing.
//
// Exports:
//   showVoidFade(label)      — full-viewport fade with a breathing circle
//   hideVoidFade()           — dismiss the active void fade
//   setStatus(label, variant)— corner status indicator ('', 'ok', 'error')
//   clearStatus()            — hide the corner indicator
//   makeStreamPulse()        — inline element for streaming gaps (returns an Element)
//
// All helpers are safe to call before DOMContentLoaded.

const VOID_FADE_ID = 'neuma-void-fade';
const STATUS_ID = 'neuma-status-indicator';

// --- Void fade (full-screen pre-render placeholder) ---

/**
 * Show a full-viewport "breathing" placeholder with a label. Call once,
 * then call hideVoidFade() when the real UI is ready to take over.
 * Multiple consecutive calls replace the label in place.
 * @param {string} label - Short mystical phrase, e.g. "The void stirs..."
 */
export const showVoidFade = (label = 'The void stirs...') => {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => showVoidFade(label), { once: true });
    return;
  }

  let el = document.getElementById(VOID_FADE_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = VOID_FADE_ID;
    el.className = 'neuma-void-fade';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', label);

    const breath = document.createElement('div');
    breath.className = 'neuma-void-fade__breath';
    el.appendChild(breath);

    const labelEl = document.createElement('div');
    labelEl.className = 'neuma-void-fade__label';
    labelEl.textContent = label;
    el.appendChild(labelEl);

    document.body.appendChild(el);
  } else {
    const labelEl = el.querySelector('.neuma-void-fade__label');
    if (labelEl) labelEl.textContent = label;
    el.setAttribute('aria-label', label);
  }

  // Force reflow so the transition fires on freshly-inserted elements
  // eslint-disable-next-line no-unused-expressions
  el.offsetHeight;
  el.classList.add('visible');
};

/**
 * Hide and remove the void fade. Safe to call even if nothing is showing.
 */
export const hideVoidFade = () => {
  const el = document.getElementById(VOID_FADE_ID);
  if (!el) return;
  el.classList.remove('visible');
  // Wait for the opacity transition (~160ms) before removing from DOM
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 200);
};

// --- Corner status indicator (non-blocking) ---

/**
 * Show a small corner badge with a label and optional variant.
 * @param {string} label - Short text, e.g. […]
 * @param {'' | 'ok' | 'error'} [variant] - Color/state variant
 */
export const setStatus = (label, variant = '') => {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => setStatus(label, variant), { once: true });
    return;
  }

  let el = document.getElementById(STATUS_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = STATUS_ID;
    el.className = 'neuma-status-indicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    const dot = document.createElement('span');
    dot.className = 'neuma-status-indicator__dot';
    el.appendChild(dot);

    const labelEl = document.createElement('span');
    labelEl.className = 'neuma-status-indicator__label';
    el.appendChild(labelEl);

    document.body.appendChild(el);
  }

  const labelEl = el.querySelector('.neuma-status-indicator__label');
  if (labelEl) labelEl.textContent = label;

  el.classList.remove('neuma-status-indicator--ok', 'neuma-status-indicator--error');
  if (variant === 'ok') el.classList.add('neuma-status-indicator--ok');
  if (variant === 'error') el.classList.add('neuma-status-indicator--error');

  // Force reflow, then show
  // eslint-disable-next-line no-unused-expressions
  el.offsetHeight;
  el.classList.add('visible');
};

/**
 * Hide and remove the corner status indicator.
 */
export const clearStatus = () => {
  const el = document.getElementById(STATUS_ID);
  if (!el) return;
  el.classList.remove('visible');
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 200);
};

// --- Inline stream pulse (for LLM gaps inside existing UI) ---

/**
 * Create a three-dot pulsing element to drop into an existing container
 * while an LLM response is streaming. Caller is responsible for removing
 * it when the stream completes.
 * @returns {HTMLElement}
 */
export const makeStreamPulse = () => {
  const wrap = document.createElement('span');
  wrap.className = 'neuma-stream-pulse';
  wrap.setAttribute('aria-label', 'Streaming response');
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('span');
    d.className = 'neuma-stream-pulse__dot';
    wrap.appendChild(d);
  }
  return wrap;
};
