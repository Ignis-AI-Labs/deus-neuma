// The model setup as one progress bar: the whole job's percent, and the time left at the measured
// speed — or none when no honest speed exists. Pure: real inputs, real outputs, nothing faked.
import { describe, expect, test } from 'vitest';
import { addSample, secondsLeft, setupProgress, timeLeftLabel } from '../../frontend/app/FirstRunChoice/setup-progress.js';
import { NOT_RUNNING, barView, settingLine } from '../../frontend/app/FirstRunChoice/model-bar-view.js';

const GB = 1_000_000_000;
const plan = { steps: [
  { id: 'download', bytes: 1.5 * GB }, { id: 'unpack', bytes: 0 }, { id: 'start', bytes: 0 }, { id: 'pull', bytes: 2.5 * GB },
] };

describe('setupProgress', () => {
  test('counts the whole job, not the step: half the server download is 18% of 4 GB', () => {
    expect(setupProgress({ state: 'running', step: 'download', completed: 0.75 * GB, total: 1.5 * GB, plan }))
      .toEqual({ done: 0.75 * GB, total: 4 * GB, pct: 18 });
  });
  test('a step that moves no bytes holds the bar where the bytes left it', () => {
    expect(setupProgress({ state: 'running', step: 'unpack', completed: 0, total: 0, plan }).pct).toBe(37);
  });
  test('the running step\'s measured total replaces the plan\'s estimate', () => {
    const p = setupProgress({ state: 'running', step: 'pull', completed: 1 * GB, total: 3 * GB, plan });
    expect(p).toEqual({ done: 2.5 * GB, total: 4.5 * GB, pct: 55 });
  });
  test('finishing and done are whole; no plan is no reading', () => {
    expect(setupProgress({ state: 'running', step: 'adopt', plan }).pct).toBe(100);
    expect(setupProgress({ state: 'done', step: 'done', plan }).pct).toBe(100);
    expect(setupProgress(null)).toEqual({ done: null, total: null, pct: null });
  });
});

describe('time left', () => {
  test('drawn from the speed inside the window', () => {
    let s = addSample([], { t: 0, done: 0 });
    s = addSample(s, { t: 4000, done: 40_000_000 }); // 10 MB/s
    expect(secondsLeft(s, 600_000_000)).toBe(60);
    expect(timeLeftLabel(60)).toBe('1 min left');
  });
  test('no honest speed — too short, or nothing moved — means no time shown', () => {
    expect(secondsLeft([{ t: 0, done: 0 }, { t: 1000, done: 5 }], 100)).toBeNull();
    expect(secondsLeft([{ t: 0, done: 9 }, { t: 5000, done: 9 }], 100)).toBeNull();
    expect(timeLeftLabel(null)).toBeNull();
  });
  test('old readings fall out of the window', () => {
    const s = addSample([{ t: 0, done: 0 }, { t: 15_000, done: 1 }], { t: 30_000, done: 2 });
    expect(s).toEqual([{ t: 15_000, done: 1 }, { t: 30_000, done: 2 }]);
  });
  test('reads as a person reads time', () => {
    expect(timeLeftLabel(42)).toBe('42 s left');
    expect(timeLeftLabel(3900)).toBe('1 h 5 min left');
  });
});

describe('barView', () => {
  const okPlan = { supported: true, enoughDisk: true, model: { name: 'Qwen3.8-4B' }, downloadBytes: 2.8 * GB, steps: [] };
  test('no model: the missing model is the line, the setup the act', () => {
    expect(barView({ mind: { state: 'not' }, plan: okPlan, job: null, error: '', readyModel: null }))
      .toEqual({ view: 'none', line: NOT_RUNNING, act: 'setup' });
  });
  test('ready names the model; a running job is a progress bar; a stopped one offers TRY AGAIN', () => {
    expect(barView({ mind: { state: 'ready' }, plan: null, job: null, error: '', readyModel: 'Qwen3.8-4B' }).line).toBe('Model ready · Qwen3.8-4B');
    expect(barView({ mind: { state: 'not' }, plan: okPlan, job: { state: 'running' }, error: '' }).view).toBe('setting');
    const said = 'The download stopped before it finished. Check the internet connection, then press TRY AGAIN; it picks up where it stopped.';
    expect(barView({ mind: { state: 'not' }, plan: okPlan, job: { state: 'failed', error: said, detail: 'terminated' }, error: '' }))
      .toEqual({ view: 'error', line: said, act: 'retry' });
    expect(barView({ mind: { state: 'not' }, plan: okPlan, job: { state: 'failed' }, error: '' }).line).toBe('The setup stopped before it finished.');
  });
  test('a plan that could not be read still says no model runs, and offers to read again', () => {
    expect(barView({ mind: { state: 'not' }, plan: null, job: null, error: 'HTTP 404' }))
      .toMatchObject({ view: 'none', line: NOT_RUNNING, act: 'reread' });
  });
  test('the setting line: step, whole percent, time left', () => {
    expect(settingLine({ step: 'pull' }, { pct: 42, seconds: 180 })).toBe('Downloading the model · 42% · 3 min left');
    expect(settingLine({ step: 'unpack' }, { pct: 37, seconds: null })).toBe('Unpacking · 37%');
  });
});
