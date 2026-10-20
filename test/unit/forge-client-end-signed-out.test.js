/**
 * Ending the voice forge is best effort, signed out included: the forge hook
 * calls endForge from a React effect cleanup, so a throw there (no session to
 * sign the request with) escaped the cleanup instead of resolving null. Real
 * module in node — no sessionStorage, so no session.
 */
import { test, expect } from 'vitest';
import { endForge } from '../../frontend/app/RelinkShell/voice-forge/forge-client.js';

test('endForge signed out resolves null and never throws', async () => {
  let thrown = null;
  let result;
  try { result = await endForge('any-session'); } catch (err) { thrown = err; }
  expect(thrown).toBeNull();
  expect(result).toBeNull();
});
