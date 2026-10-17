// The pre-flight's checks in the DOM: a group per kind of check, a line per
// check (its name, a one-line summary, its status), the full measurement one
// click away. A check that did not pass opens by itself, with what to do.
// impure — builds DOM nodes; every string goes through textContent.
import { groupOf, groupLine } from './preflight-groups.js';
import { el } from '../../utils/dom-el.js';

const STATUS_LABEL = Object.freeze({ pass: 'PASS', warn: 'NOTE', fail: 'FAIL' });

/** Open or close one check's full measurement. */
const setOpen = (rowEl, open) => {
  rowEl.classList.toggle('is-open', open);
  rowEl.querySelector('.pf-row-head').setAttribute('aria-expanded', String(open));
  rowEl.querySelector('.pf-detail').hidden = !open;
};

/** The group section a check lands in — made on first use, in serve order. */
const groupSection = (rowsEl, check) => {
  const group = groupOf(check.id);
  const found = rowsEl.querySelector(`.pf-group[data-group="${group.id}"]`);
  if (found) return found;
  const section = el('section', 'pf-group');
  section.dataset.group = group.id;
  const head = el('header', 'pf-group-head');
  head.append(el('span', 'pf-group-label', group.label), el('span', 'pf-group-tally'));
  section.append(head);
  rowsEl.append(section);
  return section;
};

/** Refresh a group's own line from the checks it now holds. */
const paintGroup = (section) => {
  const checks = [...section.querySelectorAll('.preflight-row')].map((row) => ({ status: row.dataset.status }));
  const line = section.querySelector('.pf-group-tally');
  line.textContent = groupLine(checks);
  section.classList.toggle('has-fail', checks.some((c) => c.status === 'fail'));
};

/**
 * Add one measured check to its group.
 * @param {HTMLElement} rowsEl - #preflight-rows
 * @param {{id: string, label: string, status: string, detail: string, requirement: string}} check
 */
export const renderCheck = (rowsEl, check) => {
  const section = groupSection(rowsEl, check);
  const rowEl = el('div', `preflight-row ${check.status}`);
  rowEl.dataset.check = check.id;
  rowEl.dataset.status = check.status;

  const head = el('button', 'pf-row-head');
  head.type = 'button';
  head.append(
    el('span', 'pf-mark'),
    el('span', 'pf-label', check.label),
    el('span', 'pf-summary', check.detail),
    el('span', 'pf-status', STATUS_LABEL[check.status] || check.status.toUpperCase()),
  );
  const detail = el('div', 'pf-detail');
  detail.append(el('p', 'pf-detail-text', check.detail));
  if (check.requirement) {
    const need = el('p', 'pf-requirement', check.requirement);
    if (check.status === 'pass') need.classList.add('is-quiet');
    detail.append(need);
  }
  rowEl.append(head, detail);
  head.addEventListener('click', () => setOpen(rowEl, !rowEl.classList.contains('is-open')));
  setOpen(rowEl, check.status !== 'pass');

  section.append(rowEl);
  paintGroup(section);
};

/** The panel's headline: how many checks are clear, and what needs the operator. */
export const paintTally = (tallyEl, line, state) => {
  tallyEl.textContent = line;
  tallyEl.dataset.state = state;
};
