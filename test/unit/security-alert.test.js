/**
 * The operator's ear — a watch run that lands NEW critical/high threats raises
 * ONE security_alert notification, proven with NO mock on the claimed path
 * (RULE 0): the REAL per-house designation store, the REAL lane workspace +
 * owner.json, the REAL bus, and the REAL notification store on real tmp disk.
 * The addressing law is what is proven: the alert goes to the operator of
 * the house whose ledger took the threats, CSO seated or not (ruling,
 * 2026-10-19: the seat decides who assesses, never whether the operator
 * hears) — and never to another house, even one that seats a CSO under the
 * same lane id.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { alertOnNewCriticals } from '../../backend/services/security/security-scheduler.js';
import { csoDesignation } from '../../backend/services/security/cso-designation.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { __resetCoalesce } from '../../backend/services/notification-bus.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';

const WALLET = HOUSE_A;
const CSO_LANE = 'keir';

const CRITICAL = { severity: 'critical', externalId: 'CVE-2026-0001', repo: 'neuma', title: 'a critical fixture' };
const HIGH = { severity: 'high', externalId: 'GHSA-2026-0002', repo: 'kenorie', title: 'a high fixture' };
const LOW = { severity: 'low', externalId: 'GHSA-2026-0003', repo: 'neuma', title: 'a low fixture' };
const MEDIUM = { severity: 'medium', externalId: 'GHSA-2026-0004', repo: 'neuma', title: 'a medium fixture' };

describe('security watch operator alert (real stores, real bus, gnosis)', () => {
  let houses;

  const seatGuardian = () => csoDesignation.designate(WALLET, CSO_LANE);

  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'security-alert' });
    __resetCoalesce();
  });
  afterEach(() => houses.restore());

  test('new criticals/highs raise ONE card to the house operator, lows stay silent', async () => {
    await seatGuardian();
    await alertOnNewCriticals([CRITICAL, HIGH, LOW], WALLET);
    const { records } = await readNotifications(WALLET);
    expect(records.length).toBe(1);
    const card = records[0];
    expect(card.kind).toBe(KIND.securityAlert);
    expect(card.standing).toBe(STANDING.system);
    expect(card.title).toBe('Security watch: 2 new critical/high threats');
    expect(card.detail).toContain('CRITICAL CVE-2026-0001 (neuma)');
    expect(card.detail).toContain('HIGH GHSA-2026-0002 (kenorie)');
    expect(card.detail).not.toContain('GHSA-2026-0003');
    expect(card.detail).not.toContain('no CSO seated');
    expect(card.ref).toEqual({ critical: 1, high: 1, medium: 0 });
  });

  test('a run with nothing critical or high raises nothing', async () => {
    await seatGuardian();
    await alertOnNewCriticals([LOW], WALLET);
    expect((await readNotifications(WALLET)).records.length).toBe(0);
    await alertOnNewCriticals([], WALLET);
    expect((await readNotifications(WALLET)).records.length).toBe(0);
  });

  test('no seated CSO — the card goes straight to the house operator, saying nobody else reads it', async () => {
    await alertOnNewCriticals([CRITICAL, MEDIUM], WALLET);
    const { records } = await readNotifications(WALLET);
    expect(records.length).toBe(1);
    expect(records[0].detail).toContain('no CSO seated — these wait on you');
    expect(records[0].detail).toContain('1 new medium counted in the ledger');
    expect(records[0].ref).toEqual({ critical: 1, high: 0, medium: 1 });
  });

  test('mediums alone never raise a card', async () => {
    await alertOnNewCriticals([MEDIUM, MEDIUM], WALLET);
    expect((await readNotifications(WALLET)).records.length).toBe(0);
  });

  test('house B\'s threats reach B\'s operator and never house A, though A seats a CSO under the same lane id', async () => {
    await seatGuardian();
    await alertOnNewCriticals([CRITICAL], HOUSE_B);
    expect((await readNotifications(HOUSE_A)).records.length).toBe(0);
    expect((await readNotifications(HOUSE_B)).records.length).toBe(1);
  });

  test('no house at all — fail-soft, nobody is addressed', async () => {
    await seatGuardian();
    await expect(alertOnNewCriticals([CRITICAL], undefined)).resolves.toBeNull();
    expect((await readNotifications(WALLET)).records.length).toBe(0);
  });
});
