/**
 * Resume, screen, and gather share ONE tail length. Three magic numbers
 * (5 / 20 / 40) is why coming back to a chat felt like starting over.
 */
import { describe, expect, it } from 'vitest';
import { RECENT_ROWS } from '../../core/runtime/memory-section.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.join(here, '..', '..', rel), 'utf8');

describe('the resume tail is one number', () => {
  it('is a real, generous window — not five rows', () => {
    expect(RECENT_ROWS).toBeGreaterThanOrEqual(40);
  });

  it('portal resume, latest-session load, and gather all name RECENT_ROWS', () => {
    expect(src('backend/routes/portal-bind-handlers.js')).toContain('slice(-RECENT_ROWS)');
    expect(src('backend/services/memory-context.js')).toContain('slice(-RECENT_ROWS)');
    expect(src('frontend/app/RelinkShell/session-history.js')).toContain('RECENT_ROWS');
    // a stream's resume loads through the navigation history loader (c13da2087)
    expect(src('frontend/app/RelinkShell/use-consciousness-stream.js')).toContain('loadNavigationHistory(');
    expect(src('frontend/app/RelinkShell/stream-navigation-history.js')).toContain('loadSessionMessagesStrict(neumaId, sessionId, RECENT_ROWS)');
    expect(src('backend/routes/portal-bind-handlers.js')).not.toContain('slice(-5)');
    expect(src('frontend/app/RelinkShell/session-history.js')).not.toMatch(/loadSessionMessages\([^)]+,\s*20\)/);
  });
});
