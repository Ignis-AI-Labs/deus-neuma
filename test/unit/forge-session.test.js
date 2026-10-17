/**
 * The forge session — the pure FIND → HEAR → SEAL model and its in-memory
 * store, called with real inputs (no mock: the store is a Map in this
 * process, the model is pure).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  FORGE_SESSION_TTL_MS, FORGE_STAGES, MAX_TAKES, createForgeSession, endForgeSession, forgeSessionFor,
  getForgeSession, isExpired, putForgeSession, resolveAuditionVoice, sessionView, stageOf,
  withOffered, withPin, withTakes,
} from '../../core/voice/forge-session.js';

const WALLET = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const ref = (n) => `sha256:${String(n).padStart(64, '0')}`;
const take = (n, extra = {}) => ({ ref: ref(n), door: 'library', seconds: 9, sampleRate: 24000, words: `take ${n}`, wav: Buffer.from(`wav-${n}`), ...extra });
const fresh = (neumaId = 'keir', id = `s-${neumaId}`) => createForgeSession({ id, neumaId, wallet: WALLET, now: 1000 });

const started = [];
afterEach(() => { for (const id of started.splice(0)) endForgeSession(id); });
const put = (s) => { started.push(s.id); return putForgeSession(s); };

describe('the pure model', () => {
  it('starts in FIND with the wallet lowercased', () => {
    const s = fresh();
    expect(stageOf(s)).toBe(FORGE_STAGES.FIND);
    expect(s.wallet).toBe(WALLET.toLowerCase());
  });

  it('one take found is pinned at once (HEAR); three wait for a pick', () => {
    const one = withTakes(fresh(), [take(1)], 2000);
    expect(one.ok).toBe(true);
    expect(one.session.pinned).toBe(ref(1));
    expect(stageOf(one.session)).toBe(FORGE_STAGES.HEAR);

    const three = withTakes(fresh(), [take(1), take(2), take(3)], 2000);
    expect(three.session.pinned).toBeNull();
    expect(stageOf(three.session)).toBe(FORGE_STAGES.FIND);
    const picked = withPin(three.session, ref(2), 3000);
    expect(picked.session.pinned).toBe(ref(2));
    expect(withPin(three.session, ref(9), 3000)).toEqual({ ok: false, error: 'that take is not in this forge' });
  });

  it('refuses an empty find and a take without a clip ref', () => {
    expect(withTakes(fresh(), [], 1).ok).toBe(false);
    expect(withTakes(fresh(), [{ ref: 'nope' }], 1).ok).toBe(false);
  });

  it('never holds the same take twice, and keeps the pinned take past the cap', () => {
    let s = withTakes(fresh(), [take(0)], 1).session;
    s = withTakes(s, [take(0)], 2).session;
    expect(s.takes).toHaveLength(1);
    for (let n = 1; n <= MAX_TAKES + 3; n += 3) s = withTakes(s, [take(n), take(n + 1), take(n + 2)], 3).session;
    expect(s.takes.length).toBe(MAX_TAKES);
    expect(s.takes.some((t) => t.ref === ref(0))).toBe(true);
    expect(s.pinned).toBe(ref(0));
  });

  it('offering the pinned take is SEAL; picking another goes back to HEAR', () => {
    const s = withTakes(fresh(), [take(1), take(2)], 1).session;
    const pinned = withPin(s, ref(1), 2).session;
    const offered = withOffered(pinned, ref(1), 3).session;
    expect(stageOf(offered)).toBe(FORGE_STAGES.SEAL);
    expect(stageOf(withPin(offered, ref(2), 4).session)).toBe(FORGE_STAGES.HEAR);
    expect(withOffered(pinned, ref(7), 3).ok).toBe(false);
  });

  it('expires after the TTL of no use', () => {
    const s = fresh();
    expect(isExpired(s, 1000 + FORGE_SESSION_TTL_MS)).toBe(false);
    expect(isExpired(s, 1001 + FORGE_SESSION_TTL_MS)).toBe(true);
  });

  it('the view carries no audio bytes and no wallet', () => {
    const view = sessionView(withTakes(fresh(), [take(1)], 2000).session);
    expect(view.takes[0].wav).toBeUndefined();
    expect(view.takes[0].bytes).toBe(5);
    expect(view.wallet).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('wav-1');
  });
});

describe('the store and the HEAR hook', () => {
  it('holds one forge per being: a second start replaces the first', () => {
    const now = Date.now();
    const a = put(createForgeSession({ id: 'a', neumaId: 'galen', wallet: WALLET, now }));
    const b = put(createForgeSession({ id: 'b', neumaId: 'galen', wallet: WALLET, now }));
    expect(getForgeSession(a.id)).toBeNull();
    expect(forgeSessionFor('galen').id).toBe(b.id);
  });

  it('drops a session past its TTL', () => {
    put(createForgeSession({ id: 'old', neumaId: 'signal', wallet: WALLET, now: Date.now() - FORGE_SESSION_TTL_MS - 1 }));
    expect(getForgeSession('old')).toBeNull();
  });

  it('resolveAuditionVoice: the pinned take, for the guardian only, null without a pick', () => {
    const now = Date.now();
    const s = put(createForgeSession({ id: 'hear', neumaId: 'genesis', wallet: WALLET, now }));
    expect(resolveAuditionVoice('genesis')).toBeNull();
    put(withTakes(s, [take(5)], now).session);

    const byId = resolveAuditionVoice('genesis');
    expect(byId).toMatchObject({ sessionId: 'hear', clipRef: ref(5), words: 'take 5', sampleRate: 24000, audition: true });
    expect(byId.clip.toString()).toBe('wav-5');

    const guardian = { companion: { neumaId: 'genesis' }, walletAddress: WALLET.toUpperCase().replace('0X', '0x') };
    expect(resolveAuditionVoice(guardian)?.clipRef).toBe(ref(5));
    const stranger = { companion: { neumaId: 'genesis' }, walletAddress: '0x' + '1'.repeat(40) };
    expect(resolveAuditionVoice(stranger)).toBeNull();
    expect(resolveAuditionVoice({ companion: {} })).toBeNull();

    endForgeSession('hear');
    expect(resolveAuditionVoice('genesis')).toBeNull();
  });
});
