// ── CEREMONY DISCLOSURE — what rides with the operator's words ──────────
// Extracted from StagedCeremonyScene.js under the 500-line law. The
// counts-only doctrine lives in composition-view.js; this module only builds
// DOM from its rows. The kept class delegates renderDisclosure, so `scene`
// below is exactly the StagedCeremonyScene instance.
import { compositionRows, compositionSummary, compositionParameters } from './composition-view.js';

/**
 * Render the disclosure of everything this stage sends — one row per
 * component, each naming its source, its size, and its verbatim text.
 * Built programmatically: protocol and model text never touches innerHTML.
 * @param {Object} event - a `birth:composition` event
 */
export const renderDisclosure = (scene, event) => {
  const panel = document.getElementById('ceremony-disclosure');
  const body = document.getElementById('disclosure-body');
  const summary = document.getElementById('disclosure-summary');
  if (!panel || !body || !summary) return;

  summary.textContent = compositionSummary(event).headline;

  const parameters = compositionParameters(event);
  body.replaceChildren(
    ...compositionRows(event).map((row) => buildDisclosureRow(row)),
    ...(parameters.length > 0 ? [buildDisclosureParameters(parameters)] : []),
  );

  panel.hidden = false;
  body.hidden = !scene.disclosureOpen;
};

/**
 * One disclosed component: a head that names it, and its exact text.
 * @param {Object} row - from compositionRows
 * @returns {HTMLElement}
 */
const buildDisclosureRow = (row) => {
  const wrap = document.createElement('div');
  wrap.className = 'disclosure-row';
  if (row.mine) wrap.classList.add('is-mine');
  if (row.appended) wrap.classList.add('is-appended');

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'disclosure-row-head';
  head.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'row-label';
  label.textContent = row.label;

  const origin = document.createElement('span');
  origin.className = 'row-origin';
  origin.textContent = row.origin;

  const chars = document.createElement('span');
  chars.className = 'row-chars';
  chars.textContent = row.charsLabel;

  head.append(label, origin, chars);

  const text = document.createElement('pre');
  text.className = 'row-text';
  text.hidden = true;
  text.textContent = row.text;

  head.addEventListener('click', () => {
    text.hidden = !text.hidden;
    head.setAttribute('aria-expanded', String(!text.hidden));
    wrap.classList.toggle('is-open', !text.hidden);
  });

  wrap.append(head, text);
  return wrap;
};

/**
 * The request settings that carry no prompt text — provider, model,
 * temperature, token ceiling, function schemas.
 * @param {ReadonlyArray<{label: string, value: string}>} parameters
 * @returns {HTMLElement}
 */
const buildDisclosureParameters = (parameters) => {
  const wrap = document.createElement('div');
  wrap.className = 'disclosure-parameters';
  for (const parameter of parameters) {
    const item = document.createElement('div');
    item.className = 'disclosure-parameter';

    const label = document.createElement('span');
    label.className = 'parameter-label';
    label.textContent = parameter.label;

    const value = document.createElement('span');
    value.className = 'parameter-value';
    value.textContent = parameter.value;

    item.append(label, value);
    wrap.append(item);
  }
  return wrap;
};
