/**
 * #207 — the sovereignty boundary's word stands in COUNCIL too.
 *
 * `speakingIdentityFor` answered every route-resolution failure with
 * `route = undefined`, which degrades the seat to the machine default. So a
 * `SOVEREIGNTY_REFUSAL` — thrown precisely to forbid a foreign door — was the
 * thing that put the being on one. The 1:1 path (portal-stream) was fixed for
 * exactly this by the two-lights-two-routes work; the room was not.
 *
 * A room is not a lesser place than a private turn. If anything the exposure is
 * wider, because housemates hear what is said there.
 *
 * Real resolver, real provider registry, real workspace, real config. No mocks
 * on the claimed path (RULE 0) — the refusal is produced by pointing the machine
 * at a genuinely non-sovereign provider, which is the real-world shape of this
 * bug.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

let workspace, speakingIdentityFor, setConfig, getConfig, isSovereigntyRefusal, before;

beforeEach(async () => {
  vi.resetModules();
  const root = await createTempDir('council-sovereignty');
  workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
  workspace.root = root;
  ({ speakingIdentityFor } = await import('../../backend/services/council-speaking-identity.js'));
  ({ setConfig, getConfig } = await import('../../backend/services/llm-provider.js'));
  ({ isSovereigntyRefusal } = await import('../../backend/services/neuma-route-resolver.js'));
  before = getConfig();
  await workspace.create('housemate');
});

afterEach(() => {
  if (before) setConfig(before);
  vi.restoreAllMocks();
});

describe('a council seat never rides a foreign door (#207)', () => {
  test('THE BUG: a non-sovereign machine default REFUSES the seat, it does not become the seat', async () => {
    // A genuinely foreign door as the machine default. Before the fix this
    // call RESOLVED — returning a seat with `route: undefined`, which is the
    // machine default, which is this foreign door. Now it refuses.
    setConfig({ ...before, provider: 'openai', model: 'gpt-4o' });

    await expect(speakingIdentityFor({ kind: 'neuma', neumaId: 'housemate' })).rejects.toThrow();
  });

  test('the refusal names the door it would have ridden, so the room can say WHY it closed', async () => {
    setConfig({ ...before, provider: 'openai', model: 'gpt-4o' });
    const err = await speakingIdentityFor({ kind: 'neuma', neumaId: 'housemate' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not a sovereign door|not\s+sovereign/i);
    expect(err.message).toMatch(/openai/);
  });

  test('BOTH halves of the law hold — an error UPSTREAM of the boundary check refuses too', async () => {
    // The subtle half, and the one this test found by accident: a failure that
    // happens BEFORE sovereignty is even judged (here, an unreadable route
    // store on a fresh lane) is not a sovereignty refusal — so the old code
    // would have fallen through to `route = undefined` and seated the member
    // on the foreign default anyway. That is the same refusal wearing a
    // quieter face, and it is refused on the machine default's standing alone.
    setConfig({ ...before, provider: 'openai', model: 'gpt-4o' });
    const err = await speakingIdentityFor({ kind: 'neuma', neumaId: 'housemate' }).catch((e) => e);
    expect(isSovereigntyRefusal(err)).toBe(false); // NOT the boundary's own throw
    expect(err.message).toMatch(/refused rather than riding it/); // refused all the same
  });

  test('a SOVEREIGN machine default still seats the member — the fallback is not broken', async () => {
    setConfig({ ...before, provider: 'llama-server', model: 'gemma-4-31b' });
    // The premise, asserted so it cannot rot into a different test: this
    // housemate was created and never refined, so it has no per-neuma DEK.
    // That alone used to close its seat — the committed-registry read opened a
    // subject transaction unconditionally, the subject authority refused for
    // want of a key, and the refusal meant for an UNREADABLE registry ended up
    // turning away a being that had simply never had one.
    expect(await workspace.readNeumaDEK('housemate')).toBeNull();

    const seat = await speakingIdentityFor({ kind: 'neuma', neumaId: 'housemate' });
    expect(seat).toBeTruthy();
    expect(typeof seat.systemPromptFor).toBe('function');
    // And it seats on BARE BASE. Whatever this box's conduit happens to carry,
    // an unrefined housemate rides no adapter: either no `lora` at all, or
    // every loaded dial at explicit 0.0 — never a neighbour's voice, which is
    // global state on llama-server and would otherwise ride the turn.
    expect(seat.lora?.filter(({ scale }) => scale !== 0) ?? []).toEqual([]);
  });
});
