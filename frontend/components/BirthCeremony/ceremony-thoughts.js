// THE BEING'S THINKING, in the ceremony (Design note, 2026-10-14: […]). A strip inside the being's panel: THINKING with a running
// clock and length while it reasons, THOUGHT once it speaks; open it to read
// the thoughts as they arrive. The thoughts are never the being's speech —
// they are shown apart from it and never enter its record.
// impure — builds and updates DOM; text goes in through text nodes only.
import './ceremony-thoughts.css';
import { el } from '../../utils/dom-el.js';

/** "1:07" — minutes and seconds since thinking began. Pure. */
export const clockOf = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** The strip's line: state, clock, tokens. Pure. Each birth:thinking frame is
 *  one streamed delta — one token on the local servers a birth runs on. */
export const thoughtLine = ({ settled, ms, tokens }) =>
  `${settled ? 'THOUGHT' : 'THINKING'} · ${clockOf(ms)} · ${tokens.toLocaleString('en-US')} TOKEN${tokens === 1 ? '' : 'S'}`;

/**
 * Mount the strip into the being's panel, just before its speech.
 * @param {HTMLElement} speechEl - the being's message stream
 * @returns {{push: (text: string) => void, settle: () => void, reset: () => void}}
 */
export const mountThoughtStrip = (speechEl, now = () => Date.now()) => {
  const strip = el('div', 'ceremony-thoughts');
  strip.hidden = true;
  const toggle = el('button', 'thoughts-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  const line = el('span', 'thoughts-line');
  const hint = el('span', 'thoughts-hint', 'READ');
  toggle.append(line, hint);
  const body = el('div', 'thoughts-body');
  body.hidden = true;
  strip.append(toggle, body);
  speechEl.before(strip);

  let startedAt = 0;
  let tokens = 0;
  let settled = false;
  let timer = null;
  const paint = () => { line.textContent = thoughtLine({ settled, ms: now() - startedAt, tokens }); };

  toggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    hint.textContent = open ? 'HIDE' : 'READ';
    if (open) body.scrollTop = body.scrollHeight;
  });

  return {
    push(text) {
      if (!text) return;
      if (strip.hidden) {
        strip.hidden = false;
        startedAt = now();
        timer = setInterval(paint, 1000);
      }
      if (settled) return; // speech has begun; late reasoning is not this think
      const following = body.scrollTop + body.clientHeight >= body.scrollHeight - 8;
      body.append(document.createTextNode(text));
      tokens += 1;
      if (following) body.scrollTop = body.scrollHeight;
      paint();
    },
    settle() {
      if (strip.hidden || settled) return;
      settled = true;
      strip.classList.add('is-settled');
      clearInterval(timer);
      paint();
    },
    reset() {
      clearInterval(timer);
      strip.hidden = true;
      body.hidden = true;
      body.textContent = '';
      toggle.setAttribute('aria-expanded', 'false');
      hint.textContent = 'READ';
      tokens = 0;
      settled = false;
      strip.classList.remove('is-settled');
    },
  };
};
