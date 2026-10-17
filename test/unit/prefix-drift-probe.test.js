// prefix-drift-probe — render-order fingerprints and the first departing unit.
// Counts and names only: the summary must never carry prompt text.
import { describe, test, expect } from 'vitest';
import { prefixUnits, prefixDrift } from '../../backend/services/prefix-drift-probe.js';

const tool = (name) => ({ type: 'function', function: { name, description: `${name} tool`, parameters: {} } });
const body = (tools, messages) => ({ tools: tools.map(tool), messages });

describe('prefixDrift', () => {
  const history = [{ role: 'system', content: 'HEAD' }, { role: 'user', content: 'secret words' }, { role: 'assistant', content: 'reply' }];
  test('a changed tool list is named at the first departing tool', () => {
    const d = prefixDrift(prefixUnits(body(['a', 'b'], history)), prefixUnits(body(['a', 'x', 'b'], history)));
    expect(d.at).toEqual({ kind: 'tool', label: 'x' });
    expect(d.shared).toBe(2); // kwargs + tool a
  });
  test('a growing conversation departs only at the new message', () => {
    const d = prefixDrift(prefixUnits(body(['a'], history)), prefixUnits(body(['a'], [...history, { role: 'user', content: 'next' }])));
    expect(d.at).toEqual({ kind: 'message', label: '3:user' });
    expect(d.sharedChars).toBe(d.totalChars - JSON.stringify('next').length);
  });
  test('the summary never carries content', () => {
    const d = prefixDrift(prefixUnits(body(['a'], history)), prefixUnits(body(['a'], [history[0], { role: 'user', content: 'other secret' }])));
    expect(JSON.stringify(d)).not.toMatch(/secret|HEAD|reply/);
    expect(d.at).toEqual({ kind: 'message', label: '1:user' });
  });
});
