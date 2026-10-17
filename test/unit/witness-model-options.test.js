import { expect, test } from 'vitest';
import { witnessModelOptions } from '../../backend/services/witness-model-options.js';
import { modelBarOptions } from '../../frontend/app/RelinkShell/model-bar-view.js';
import { newerClientVersion } from '../../backend/services/openai-client-version.js';

const entry = Object.freeze({ id: 'example', defaultModel: 'retired', models: [{ id: 'retired' }] });

test('release compatibility advances numerically without accepting prereleases or downgrades', () => {
  expect(newerClientVersion('0.153.0', '0.154.0')).toBe('0.154.0');
  expect(newerClientVersion('0.99.0', '0.100.0')).toBe('0.100.0');
  for (const candidate of ['0.145.0', '0.154.0-beta', 'invalid', null]) {
    expect(newerClientVersion('0.153.0', candidate)).toBe('0.153.0');
  }
});

test('live replacement removes retired static models for any witness provider', () => {
  const view = witnessModelOptions(entry, [{ id: 'current', name: 'Current', _live: true }]);
  expect(view).toEqual({ catalogSource: 'live', models: [{ id: 'current', name: 'Current' }] });
  expect(modelBarOptions({ ...view, route: { model: 'retired' } })).toEqual([
    { value: 'retired', label: 'retired · UNAVAILABLE', disabled: true },
    { value: 'current', label: 'Current' },
  ]);
});

test('offline fallback never labels the saved model retired', () => {
  const view = witnessModelOptions(entry, []);
  expect(view.catalogSource).toBe('fallback');
  expect(modelBarOptions({ ...view, route: { model: 'saved' } })[0])
    .toEqual({ value: 'saved', label: 'saved' });
});

test('successive live catalogs replace choices without altering the route', () => {
  const route = Object.freeze({ model: 'first' });
  for (const id of ['first', 'replacement']) {
    const view = witnessModelOptions(entry, [{ id, _live: true }, { id, _live: true }]);
    expect(view.models).toEqual([{ id, name: id }]);
    expect(modelBarOptions({ ...view, route }).some((option) => option.value === id)).toBe(true);
  }
  expect(route.model).toBe('first');
});
