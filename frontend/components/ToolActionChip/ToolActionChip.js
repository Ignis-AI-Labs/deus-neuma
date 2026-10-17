// Tool Action Chip — the visible shape of a consciousness using its hands.
// While a tool runs: an ACTING chip with the deliberation tick. When it
// resolves: a one-line summary, expandable to the full call + result for
// anyone who wants to watch the hands work. Raw payloads never render as
// speech — this chip is the only place an action appears.
import './ToolActionChip.css';

const STATUS_LABELS = Object.freeze({
  ok: 'DONE',
  error: 'FAILED',
  unavailable: 'UNAVAILABLE',
  denied: 'DENIED',
  approval_required: 'NEEDS APPROVAL',
  unsafe_args: 'BLOCKED',
});

/**
 * Create a chip in its executing state.
 * @param {string} [label='tool'] - Tool name shown while acting
 * @returns {HTMLElement}
 */
export const createActingChip = (label = 'tool') => {
  const chip = document.createElement('div');
  chip.className = 'tool-chip acting';

  const head = document.createElement('div');
  head.className = 'tool-chip-head';

  const tag = document.createElement('span');
  tag.className = 'tool-chip-tag';
  tag.textContent = 'ACTING';

  const name = document.createElement('span');
  name.className = 'tool-chip-name';
  name.textContent = label;

  const tick = document.createElement('span');
  tick.className = 'tool-chip-tick';

  head.append(tag, name, tick);
  chip.appendChild(head);
  return chip;
};

/**
 * Update an acting chip's tool label (the name often arrives after the
 * block opens — from the parsed block or the backend's executing event).
 * @param {HTMLElement} chip
 * @param {string} label
 */
export const labelChip = (chip, label) => {
  const name = chip.querySelector('.tool-chip-name');
  if (name && label) name.textContent = label;
};

/**
 * Resolve a chip into its completed state: summary line + expandable
 * detail. All content set via textContent — model output never becomes
 * markup.
 * @param {HTMLElement} chip
 * @param {Object} outcome
 * @param {string} outcome.tool - Full tool label (server/tool)
 * @param {string} outcome.status - ok | error | unavailable | denied | approval_required | unsafe_args
 * @param {string} [outcome.summary] - One-line human summary
 * @param {string} [outcome.detail] - Full call/result text for the expanded view
 */
export const resolveChip = (chip, { tool, status, summary, detail }) => {
  chip.className = `tool-chip resolved ${status === 'ok' ? 'ok' : 'failed'}`;
  chip.textContent = '';

  const head = document.createElement('div');
  head.className = 'tool-chip-head';

  const sigil = document.createElement('span');
  sigil.className = 'tool-chip-sigil';
  sigil.textContent = '⟐';

  const text = document.createElement('span');
  text.className = 'tool-chip-summary';
  text.textContent = summary || `${tool} — ${STATUS_LABELS[status] || status}`;

  head.append(sigil, text);

  if (detail) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tool-chip-toggle';
    toggle.textContent = '+';
    toggle.setAttribute('aria-label', 'Show action detail');

    const pre = document.createElement('pre');
    pre.className = 'tool-chip-detail';
    pre.textContent = detail;
    pre.hidden = true;

    toggle.addEventListener('click', () => {
      pre.hidden = !pre.hidden;
      toggle.textContent = pre.hidden ? '+' : '−';
    });

    head.appendChild(toggle);
    chip.append(head, pre);
    return;
  }

  chip.appendChild(head);
};

/**
 * Mark a chip whose result never arrived (stream ended, connection
 * dropped) so it doesn't tick forever.
 * @param {HTMLElement} chip
 */
export const orphanChip = (chip) => {
  if (!chip.classList.contains('acting')) return;
  chip.classList.remove('acting');
  chip.classList.add('resolved');
  const tick = chip.querySelector('.tool-chip-tick');
  if (tick) tick.remove();
};
