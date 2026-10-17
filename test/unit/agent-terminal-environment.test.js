import { expect, test } from 'vitest';
import { agentTerminalEnvironment, agentTerminalPath } from '../../backend/services/agent-terminal-environment.js';

test('agent environment retains user essentials and excludes backend secrets and session markers', () => {
  const source = Object.freeze({ HOME: '/home/operator', SHELL: '/bin/sh', LANG: 'en_US.UTF-8',
    PATH: '/app/node_modules/.bin:/home/operator/bin:/usr/bin', TERM: 'other',
    NEUMA_SECRETS_FILE: '/private', VENDOR_API_KEY: 'sentinel', ACCESS_TOKEN: 'sentinel',
    CLAUDE_CODE_SESSION_ID: 'sentinel', NODE_OPTIONS: '--inspect', UNKNOWN: 'sentinel' });
  expect(agentTerminalEnvironment(source, 'linux')).toEqual({ HOME: '/home/operator', SHELL: '/bin/sh',
    LANG: 'en_US.UTF-8', PATH: '/home/operator/bin:/usr/bin', TERM: 'xterm-256color' });
});

test('Windows environment retains mixed-case OS essentials without retaining credentials', () => {
  expect(agentTerminalEnvironment({ SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\cmd.exe',
    Path: 'C:\\app\\NODE_MODULES\\.BIN;C:\\Windows\\System32', USERPROFILE: 'C:\\Users\\operator',
    APPDATA: 'C:\\Users\\operator\\AppData', SECRET_TOKEN: 'sentinel' }, 'win32'))
    .toEqual({ SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\cmd.exe', USERPROFILE: 'C:\\Users\\operator',
      APPDATA: 'C:\\Users\\operator\\AppData', PATH: 'C:\\Windows\\System32', TERM: 'xterm-256color' });
});

test('PATH filtering handles trailing separators and preserves similarly named user directories', () => {
  expect(agentTerminalPath('/app/node_modules/.bin/:/usr/bin:/mine/.bin:/mine/node_modules/.binary', 'linux'))
    .toBe('/usr/bin:/mine/.bin:/mine/node_modules/.binary');
  expect(agentTerminalPath('"C:\\app\\node_modules\\.bin";C:\\Tools', 'win32')).toBe('C:\\Tools');
  expect(agentTerminalEnvironment({}, 'linux')).toEqual({ PATH: '', TERM: 'xterm-256color' });
});
