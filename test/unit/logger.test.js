// Real Node output pipes; no interception of the logger's write boundary.
import { describe, test, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
import { createLogger } from '../../backend/services/logger.js';

const runNode = promisify(execFile);
const loggerUrl = new URL('../../backend/services/logger.js', import.meta.url).href;

// impure — child owns its environment and output streams; parent globals stay intact.
const outputFor = async (body, mode = 'development') => runNode(process.execPath, [
  '--input-type=module', '--eval', `import { createLogger } from ${JSON.stringify(loggerUrl)};\n${body}`,
], { env: { ...process.env, NODE_ENV: mode, LOG_LEVEL: 'debug' }, timeout: 5000, maxBuffer: 64 * 1024 });

const lines = (output) => output.trimEnd().split('\n');

describe('Structured Logger — real process output', () => {
  test('info writes to stdout', async () => {
    const { stdout, stderr } = await outputFor("createLogger('Test').info('hello');");
    expect(lines(stdout)).toHaveLength(1);
    expect(stdout).toContain('Test');
    expect(stdout).toContain('hello');
    expect(stderr).toBe('');
  });

  test('error writes to stderr', async () => {
    const { stdout, stderr } = await outputFor("createLogger('Test').error('bad thing');");
    expect(lines(stderr)).toHaveLength(1);
    expect(stderr).toContain('bad thing');
    expect(stdout).toBe('');
  });

  test('warn writes to stdout', async () => {
    const { stdout, stderr } = await outputFor("createLogger('Test').warn('caution');");
    expect(lines(stdout)).toHaveLength(1);
    expect(stdout).toContain('caution');
    expect(stderr).toBe('');
  });

  test('child logger prepends parent context', async () => {
    const { stdout } = await outputFor("createLogger('Server').child('Birth').info('stage complete');");
    expect(stdout).toContain('Server.Birth');
  });

  test('metadata included in output', async () => {
    const { stdout } = await outputFor("createLogger('Test').info('event', { stage: 3, name: 'neuma-1' });");
    expect(stdout).toContain('stage');
    expect(stdout).toContain('3');
    expect(stdout).toContain('neuma-1');
  });

  test('JSON format in production mode', async () => {
    const { stdout, stderr } = await outputFor("createLogger('Prod').info('test message', { key: 'val' });", 'production');
    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({ level: 'info', context: 'Prod', msg: 'test message', key: 'val' });
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false);
    expect(stderr).toBe('');
  });

  test('logger is frozen', () => {
    const log = createLogger('Test');
    expect(Object.isFrozen(log)).toBe(true);
    expect(() => { log.info = 'nope'; }).toThrow();
  });
});
