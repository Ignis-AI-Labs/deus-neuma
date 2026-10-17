import { describe, expect, test } from 'vitest';
import { executionKind, executionPresentation } from '../../backend/services/execution-presentation.js';
import { cueForAct, ACT_CUES } from '../../frontend/services/act-sound-map.js';
import { EXECUTION_SOUNDS } from '../../frontend/services/execution-sounds.js';
import sprite from '../../frontend/sounds-baked/sprite.json';

describe('execution identity', () => {
  test.each([
    ['npm run build:main', 'build'], ['cd app && npm run build\n', 'build'],
    ['CI=1 npm test', 'test'], ['env CI=1 pnpm run typecheck', 'check'],
    ['npx eslint src', 'check'], ['npm ci', 'install'], ['git status --short', 'git'],
    ['npm run lint && npm run build', 'batch'], ['sed -i s/old/new/ file', 'edit'],
    ['rg needle src', 'search'], ['cat notes.md', 'read'], ['ls src', 'list'],
    ['rm old.txt', 'delete'], ['mv before after', 'move'], ['mkdir output', 'write'],
    ['printf "npm run build"', 'execute'], ['python -c "print(\'npm test\')"', 'execute'],
    ['node --check file.js', 'check'], ['node --test file.js', 'test'],
    ['npx vite build', 'build'], ['npx vite', 'execute'],
    ['python <<PY\nprint("build")\nPY', 'execute'], [null, 'execute'],
  ])('%s is %s', (command, expected) => expect(executionKind(command)).toBe(expected));

  test('the complete command remains beside its honest outcome', () => {
    const command = `npm run build -- ${'long-path/'.repeat(25)}file.js`;
    expect(executionPresentation(command, { result: { exitCode: 0 } }).summary)
      .toBe(`BUILD · ${command} — exit 0`);
    expect(executionPresentation(command, { result: { exitCode: null, timedOut: true } }).summary).toContain('timed out');
    expect(executionPresentation(command, { error: new Error('spawn') }).summary).toContain(`${command} — failed`);
  });

  test('each recognized category has a baked cue; output chunks do not replay it', () => {
    for (const [activity, { cue }] of Object.entries(EXECUTION_SOUNDS)) {
      expect(ACT_CUES).toContain(cue);
      expect(sprite.events[cue].duration).toBeGreaterThan(0);
      expect(cueForAct({ tool: 'coding/execute', status: 'executing', activity })).toBe(cue);
      expect(cueForAct({ tool: 'coding/execute', status: 'executing', activity, progress: true })).toBeNull();
      expect(cueForAct({ tool: 'coding/execute', status: 'ok', activity })).toBeNull();
      expect(cueForAct({ tool: 'coding/execute', status: 'error', activity })).toBe('actFailed');
    }
    const cues = Object.values(EXECUTION_SOUNDS).map(({ cue }) => cue);
    expect(new Set(cues).size).toBe(cues.length);
  });
});
