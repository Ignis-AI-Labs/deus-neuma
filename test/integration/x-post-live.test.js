/**
 * LIVE X posting — the real postToX against the real X API v2 with the real
 * witness credentials (RULE 0: the only true proof of the posting path).
 *
 * Double-gated and skip-honest: posting is OUTWARD-FACING — it publishes to
 * a real public account — so beyond the four credentials this requires the
 * operator's explicit X_POST_LIVE=yes for the run. Never enable it in a
 * routine CI/local sweep.
 */
import { describe, expect, it } from 'vitest';
import { postToX, xPostCredentials } from '../../backend/services/social/x-poster.js';

const creds = xPostCredentials();
const optedIn = process.env.X_POST_LIVE === 'yes';

describe.skipIf(!creds || !optedIn)('postToX (LIVE — real X API, real account)', () => {
  it('publishes a post and returns its real id', async () => {
    const text = `NEUMA platform live-path proof ${new Date().toISOString()}`;
    const outcome = await postToX(creds, text);
    expect(outcome.ok).toBe(true);
    expect(outcome.id).toMatch(/^\d+$/);
  }, 30000);
});

describe('postToX without credentials', () => {
  it('fails closed with an honest reason, never throwing', async () => {
    const outcome = await postToX(null, 'anything');
    expect(outcome).toEqual({ ok: false, detail: 'X credentials are not configured' });
  });
});
