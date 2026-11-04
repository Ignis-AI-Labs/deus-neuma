/**
 * THE INSTALLER TEMPLATE PATCH (scripts/nsis-template-patch.mjs, scripts/patch-nsis-template.mjs).
 * The rule is pure; the proof that it matters is the install itself (0 crashes in 14 fresh installs,
 * against 6 in 8 before, on Windows 11). Here the REAL electron-builder template is read and patched.
 */
import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { OVER_READ, SAFE_READ, UPSTREAM_READ, patchMultiUser } from '../../scripts/nsis-template-patch.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TEMPLATE = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'multiUser.nsh');

describe('the rule', () => {
  test('the 2 KB read becomes a read that stops at the end of the string', () => {
    const out = patchMultiUser(`a\n  ${OVER_READ}\nb`);
    expect(out.state).toBe('patched');
    expect(out.text).toBe(`a\n  ${SAFE_READ}\nb`);
  });
  test('a patched template is left alone', () => {
    expect(patchMultiUser(`x ${SAFE_READ} y`)).toEqual({ state: 'already', text: `x ${SAFE_READ} y` });
  });
  test("electron-builder's own bounded copy (26+) is safe as shipped and left alone", () => {
    expect(patchMultiUser(`x ${UPSTREAM_READ} y`)).toEqual({ state: 'upstream', text: `x ${UPSTREAM_READ} y` });
  });
  test('a template that changed under us is reported, not guessed at', () => {
    expect(patchMultiUser('nothing of ours').state).toBe('absent');
  });
});

describe('the real electron-builder template', () => {
  test('after the check it holds a safe read (ours or upstream bounded one) and never the over-read', () => {
    expect(fs.existsSync(TEMPLATE)).toBe(true);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'patch-nsis-template.mjs'), '--check'], { encoding: 'utf8' });
    const text = fs.readFileSync(TEMPLATE, 'utf8');
    expect(text.includes(SAFE_READ) || text.includes(UPSTREAM_READ)).toBe(true);
    expect(text).not.toContain(OVER_READ);
  });
});
