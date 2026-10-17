// Session-follow pure decisions, with real authentication parsing.
import { describe, it, expect } from 'vitest';

const {
  emptyBind, bindAfterInbound, bindAfterOutbound, sameSitting, followFrame, worthParsing,
  walletOfRequest, FOLLOW_FRAME,
} = await import('../../backend/services/session-follow.js');

describe('the pure decisions', () => {
  it('follows what the surface says about where it sits, and that the operator spoke', () => {
    let bind = emptyBind('0xryan');
    bind = bindAfterInbound(bind, { type: 'companion:manifest', neumaId: 'ke' });
    expect(bind).toMatchObject({ neumaId: 'ke', sessionId: null, spoke: false });
    bind = bindAfterInbound(bind, { type: 'portal:resume', neumaId: 'ke', sessionId: 's1' });
    expect(bind.sessionId).toBe('s1');
    bind = bindAfterInbound(bind, { type: 'consciousness:stream', content: 'hi' });
    expect(bind.spoke).toBe(true);
    bind = bindAfterInbound(bind, { type: 'portal:new-session' });
    expect(bind).toMatchObject({ sessionId: null, spoke: false });
    expect(bindAfterInbound(bind, { type: 'voice:audio' })).toBe(bind);
  });
  it('announces a start on the first frame back after the operator spoke — not on thinking alone', () => {
    const quiet = bindAfterOutbound(emptyBind('0xryan'), { type: 'consciousness:thinking', content: '…' });
    expect(quiet.phase).toBeNull();
    const spoke = bindAfterInbound(emptyBind('0xryan'), { type: 'consciousness:stream', content: 'hi' });
    const start = bindAfterOutbound(spoke, { type: 'tool:usage', tool: 'system/tool_search' });
    expect(start.phase).toBe('started');
    expect(bindAfterOutbound(start.bind, { type: 'consciousness:stream', text: 'a' }).phase).toBeNull();
    const done = bindAfterOutbound(start.bind, { type: 'consciousness:complete', sessionId: 's9' });
    expect(done.phase).toBe('settled');
    expect(done.bind).toMatchObject({ sessionId: 's9', inTurn: false, spoke: false });
    expect(bindAfterOutbound(done.bind, { type: 'consciousness:stream' }).phase).toBeNull();
  });
  it('knows a sitting: wallet, being, and session all agree, and none is blank', () => {
    const a = { wallet: '0xryan', neumaId: 'ke', sessionId: 's1' };
    expect(sameSitting(a, { ...a })).toBe(true);
    expect(sameSitting(a, { ...a, wallet: '0xeli' })).toBe(false);
    expect(sameSitting(a, { ...a, sessionId: 's2' })).toBe(false);
    expect(sameSitting({ ...a, sessionId: null }, { ...a, sessionId: null })).toBe(false);
    // A socket answered before it named its being still matches on the session.
    expect(sameSitting({ ...a, neumaId: null }, a)).toBe(true);
    expect(sameSitting(a, { ...a, neumaId: null })).toBe(true);
    expect(sameSitting(a, { ...a, neumaId: 'rugevil' })).toBe(false);
  });
  it("parses only the turn's own frames, and reads the wallet off the upgrade", () => {
    expect(worthParsing('{"type":"portal:heartbeat"}')).toBe(false);
    expect(worthParsing('{"type":"consciousness:complete","sessionId":"s1"}')).toBe(true);
    expect(worthParsing('{"type":"tool:usage"}')).toBe(true);
    expect(worthParsing(Buffer.from('x'))).toBe(false);
    expect(walletOfRequest({ url: '/ws?token=corwin' })).toBeNull();
    expect(walletOfRequest({ url: '/ws' })).toBeNull();
    expect(walletOfRequest({ url: '/ws?token=nope' })).toBeNull();
    expect(followFrame('settled', { neumaId: 'ke', sessionId: 's1' })).toEqual({ type: FOLLOW_FRAME, phase: 'settled', neumaId: 'ke', sessionId: 's1' });
  });
});
