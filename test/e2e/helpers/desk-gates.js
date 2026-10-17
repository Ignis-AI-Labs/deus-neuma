// The gates an unsealed lane raises over the desk. Each intercepts every
// pointer until the operator steps past it through the gate's own honest door
// — the owed acts stay owed; the desk becomes drivable.
//
// Two traps this helper exists to close:
//   - the gates rise on their own probes, in no fixed order, and the voice
//     seal gate lies OVER the birth setup gate. `isVisible` never waits, so a
//     check-once helper misses a gate still probing, and a click on the lower
//     gate lands on the upper one. So: wait for ANY gate, clear the topmost,
//     look again.
//   - the birth setup door was renamed from STAND ASIDE to CONTINUE TO THE
//     DESK; a helper pinned to the old words silently let the gate stand.
import { expect } from '@playwright/test';

const GATES = Object.freeze([ // topmost first
  ['.voice-seal-gate', /STAND ASIDE/],
  ['.birth-setup-gate', /CONTINUE TO THE DESK|STAND ASIDE/],
]);

export const passDeskGates = async (page, timeout = 8000) => {
  const any = page.locator(GATES.map(([gate]) => gate).join(', ')).first();
  for (let pass = 0; pass < GATES.length * 2; pass++) {
    const risen = await any.waitFor({ state: 'visible', timeout }).then(() => true, () => false);
    if (!risen) return;
    for (const [gate, door] of GATES) {
      if (await page.locator(gate).count()) {
        await page.locator(`${gate} button`, { hasText: door }).click();
        await expect(page.locator(gate)).toHaveCount(0);
        break;
      }
    }
  }
};
