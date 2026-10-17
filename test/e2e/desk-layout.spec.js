// @ts-check
//
// Impure test module: drives a REAL chromium page (Rule 1 marker, file level).
import { test, expect } from '@playwright/test';

/**
 * F-02 gnosis — slot-keyed desk layouts, proven on REAL browser storage:
 * the actual window-storage.js module runs in a live page served by the
 * dev backend.
 *
 *   - Desk 1 (and any plain browser tab) uses EXACTLY the pre-multi-window
 *     keys — the layout every witness already has survives untouched.
 *   - Desk N ≥ 2 namespaces every geometry + open-set key by its slot, so
 *     the window opened as desk N reclaims desk N's layout on restart.
 *   - Slots are isolated: desk 2's layout never bleeds into desk 1's.
 *
 * Requires the dev backend (:3355); skips honestly when down.
 */

const ORIGIN = process.env.NEUMA_DEV_ORIGIN || 'http://127.0.0.1:3355';
const MODULE = '/frontend/app/windowing/window-storage.js';

const up = await fetch(`${ORIGIN}/api/v1/health`).then((r) => r.ok).catch(() => false);

test.describe('slot-keyed desk layouts (real browser storage)', () => {
  test.skip(!up, `dev backend not running at ${ORIGIN}`);

  test('slot 1 keeps legacy keys; slots ≥2 namespace; no bleed', async ({ page }) => {
    await page.goto(`${ORIGIN}/api/v1/health`);
    const r = await page.evaluate(async (modPath) => {
      const out = {};
      localStorage.clear();
      localStorage.setItem('walletAddress', '0xAbCd');

      // Desk 1 (no shell marker at all — a plain tab)
      delete window.neuma;
      let mod = await import(`${modPath}?d1`);
      mod.saveGeometry('chat', { x: 1, y: 2, w: 300, h: 200 });
      mod.saveDesk([{ id: 'chat' }]);
      out.legacyGeomKey = localStorage.getItem('0xabcd:win:chat') !== null;
      out.legacyDeskKey = localStorage.getItem('0xabcd:win:desk:windows') !== null;

      // Desk 2 (the shell's preload exposes the slot)
      window.neuma = { deskSlot: 2 };
      mod = await import(`${modPath}?d2`);
      mod.saveGeometry('chat', { x: 9, y: 9, w: 500, h: 400 });
      mod.saveDesk([{ id: 'chat' }, { id: 'house' }]);
      out.slot2GeomKey = localStorage.getItem('0xabcd:win:desk2:chat') !== null;
      out.slot2DeskKey = localStorage.getItem('0xabcd:win:desk2:desk:windows') !== null;

      // Isolation both ways: each desk reads its OWN layout
      out.slot2Geom = mod.loadGeometry('chat');
      out.slot2Desk = mod.loadDesk();
      delete window.neuma;
      mod = await import(`${modPath}?d1b`);
      out.slot1Geom = mod.loadGeometry('chat');
      out.slot1Desk = mod.loadDesk();

      // Restart semantics: a FRESH page context opened as desk 2 reads
      // desk 2's persisted layout (same keys, new module instance).
      window.neuma = { deskSlot: 2 };
      mod = await import(`${modPath}?d2b`);
      out.slot2Reclaim = mod.loadGeometry('chat');

      // The no-wallet branch carries the same slot segment (pre-auth tab)
      localStorage.removeItem('walletAddress');
      mod.saveGeometry('chat', { x: 3, y: 3, w: 100, h: 100 });
      out.noWalletKey = localStorage.getItem('win:desk2:chat') !== null;
      localStorage.setItem('walletAddress', '0xAbCd');

      // slotSegment purity at the edges
      out.segments = [mod.slotSegment(1), mod.slotSegment(2), mod.slotSegment(7),
        mod.slotSegment(null), mod.slotSegment('2'), mod.slotSegment(1.5)];
      return out;
    }, MODULE);

    expect(r.legacyGeomKey).toBe(true);   // exactly the pre-F-02 key
    expect(r.legacyDeskKey).toBe(true);
    expect(r.slot2GeomKey).toBe(true);
    expect(r.slot2DeskKey).toBe(true);
    expect(r.slot2Geom).toEqual({ x: 9, y: 9, w: 500, h: 400 });
    expect(r.slot2Desk).toEqual([{ id: 'chat' }, { id: 'house' }]);
    expect(r.slot1Geom).toEqual({ x: 1, y: 2, w: 300, h: 200 });
    expect(r.slot1Desk).toEqual([{ id: 'chat' }]);
    expect(r.slot2Reclaim).toEqual({ x: 9, y: 9, w: 500, h: 400 });
    expect(r.noWalletKey).toBe(true);
    expect(r.segments).toEqual(['', 'desk2:', 'desk7:', '', '', '']);
  });
});
