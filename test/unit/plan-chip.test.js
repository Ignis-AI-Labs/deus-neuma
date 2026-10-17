// plan-chip.test.js — what the operator reads BEFORE saying yes to a team plan,
// rendered for real (react-dom/server) over the segment shape the reducer makes.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanChip } from '../../frontend/app/RelinkShell/PlanChip.jsx';

const STEPS = [{ id: 'write', member: 'Keir', task: 'write keir.md', needs: [], files: ['keir.md'] }];
const render = (segment) => renderToStaticMarkup(createElement(PlanChip, {
  segment: { id: 'p1', phase: 'pending', name: 'HANDS', goal: 'Prove it.', steps: STEPS, status: null, notes: '', detail: '', ...segment },
  onRespond: () => {},
}));

describe('the plan card names every grant before the yes', () => {
  it('a team plan that names no directory says a fresh arena will be made, with its budget', () => {
    const html = render({ planKind: 'team', workspace: null });
    expect(html).toContain('WORKSPACE A FRESH ARENA FOR THIS RUN (MADE AT START) · 512MB BUDGET');
    expect(html).toContain('DELIVERS: keir.md');
  });

  it('a named workspace is shown as named', () => {
    const html = render({ planKind: 'team', workspace: { root: '/house/arena', budgetBytes: 100 * 1024 * 1024 } });
    expect(html).toContain('WORKSPACE /house/arena · 100MB BUDGET');
    expect(html).not.toContain('A FRESH ARENA');
  });

  it('a chat plan carries no workspace line at all', () => {
    expect(render({ planKind: 'chat', workspace: null })).not.toContain('WORKSPACE');
  });
});
