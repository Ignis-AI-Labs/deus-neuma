import { describe, expect, it } from 'vitest';
import { canonicalDeskLane, issueDeskTicket, resolveDeskTicket } from '../../backend/services/desk-tickets.js';

const address = '0x1111111111111111111111111111111111111111';
const base = { address, sessionExpiresAt: 100_000, path: '/api/v1/gallery/file', query: { rootId: 'root', rel: 'a.png' } };

describe('P6-INFO-DESK-BEARER exact-resource tickets', () => {
  it('admits only the exact wallet, method, path and resource', () => {
    const issued = issueDeskTicket({ ...base, now: 1000 });
    expect(issued.expiresAt).toBe(61_000);
    expect(resolveDeskTicket(issued.ticket, { ...base, now: 2000 })).toMatchObject({ address });
    expect(resolveDeskTicket(issued.ticket, { ...base, query: { rootId: 'root', rel: 'other.png' }, now: 2000 })).toBeNull();
    expect(resolveDeskTicket(issued.ticket, { ...base, path: '/api/v1/user/files/events', query: {}, now: 2000 })).toBeNull();
    expect(resolveDeskTicket(issued.ticket, { ...base, method: 'POST', now: 2000 })).toBeNull();
    expect(resolveDeskTicket(issued.ticket, { ...base, now: 61_000 })).toBeNull();
  });

  it('does not confuse two wallets or accept unknown/extra lane parameters', () => {
    const first = issueDeskTicket({ ...base, now: 1000 });
    const second = issueDeskTicket({ ...base, address: '0x2222222222222222222222222222222222222222', now: 1000 });
    expect(first.ticket).not.toBe(second.ticket);
    expect(resolveDeskTicket(first.ticket, { ...base, now: 1000 }).address).toBe(address);
    expect(resolveDeskTicket(second.ticket, { ...base, now: 1000 }).address).toBe('0x2222222222222222222222222222222222222222');
    expect(canonicalDeskLane({ ...base, query: { ...base.query, token: 'full-bearer' } })).toBeNull();
    expect(issueDeskTicket({ ...base, path: '/api/v1/workspace/private' })).toBeNull();
  });
});
