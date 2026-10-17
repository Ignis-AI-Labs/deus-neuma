/**
 * The operator's ear — a watch run that lands NEW critical/high threats raises
 * ONE security_alert notification, proven with NO mock on the claimed path
 * (RULE 0): the REAL per-house designation store, the REAL lane workspace +
 * owner.json, the REAL bus, and the REAL notification store on real tmp disk.
 * The addressing law is what is proven: the alert goes to the house whose
 * ledger took the threats, only while that house seats a CSO — and with no
 * seat it reaches NOBODY, never everybody, never another house that seats a
 * CSO under the same lane id.
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
    expect(card.ref).toEqual({ critical: 1, high: 1 });
  });

  test('a run with nothing critical or high raises nothing', async () => {
    await seatGuardian();
    await alertOnNewCriticals([LOW], WALLET);
    expect((await readNotifications(WALLET)).records.length).toBe(0);
    await alertOnNewCriticals([], WALLET);
    expect((await readNotifications(WALLET)).records.length).toBe(0);
  });

  test('no seated CSO — the alert has no address and reaches nobody', async () => {
    await alertOnNewCriticals([CRITICAL], WALLET);
    expect((await readNotifications(WALLET)).records.length).toBe(0);
  });

  test('house B\'s threats never reach house A, though A seats a CSO under the same lane id', async () => {
    await seatGuardian();
    await alertOnNewCriticals([CRITICAL], HOUSE_B);
    expect((await readNotifications(HOUSE_A)).records.length).toBe(0);
    expect((await readNotifications(HOUSE_B)).records.length).toBe(0);
  });

  test('no house at all — fail-soft, nobody is addressed', async () => {
    await seatGuardian();
    await expect(alertOnNewCriticals([CRITICAL], undefined)).resolves.toBeUndefined();
    expect((await readNotifications(WALLET)).records.length).toBe(0);
  });
});
