// @ts-check
// Desk e2e — dock, RECORD, TERMINAL, PRESS, LOOK, SWITCHER, DATA, window cycling.
// Split from desk.spec.js (SIZE-017); the shared real-auth harness lives in
// helpers/desk-harness.js.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import { BACKEND, token, addr, setupDesk } from './helpers/desk-harness.js';

setupDesk();

test('desk renders with the taskbar', async ({ page }) => {
  await expect(page.locator('.relink')).toBeVisible();
  // THE TASKBAR (docs/work/os-taskbar-launcher.md): the launcher, the pinned
  // apps, the tray — every app one click from the bar or the launcher.
  await expect(page.locator('.taskbar-launcher')).toBeVisible();
  await expect(page.locator('.taskbar-apps .taskbar-app').first()).toBeVisible();
  await expect(page.locator('.taskbar-tray .taskbar-app[data-app-id="wallet"]')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('RECORD: the honest record panel renders — no fabricated stats, no crash', async ({ page }) => {
  await openDockApp(page, 'RECORD');
  // The panel renders either the record sections or the honest empty state.
  await expect(page.locator('.sheet')).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('RECORD: the parallel-team-ceiling card renders honestly and gates on consent', async ({ page }) => {
  await openDockApp(page, 'RECORD');
  await expect(page.locator('.sheet')).toBeVisible();

  // The capacity card lives on the SUBSTRATE tab's page and takes no neumaId —
  // it is a rig fact. It renders in exactly one of the honest states, never a fabricated
  // number: NOT MEASURED (local, unrun), NOT MEASURABLE (remote provider), or a
  // real measured headline from a prior scan.
  const cap = page.locator('.rec-cap');
  await expect(cap).toBeHidden(); // each tab is its own page — GENOME opens first
  await page.getByRole('tab', { name: /SUBSTRATE/ }).click();
  await expect(cap).toBeVisible();
  await expect(cap).toContainText('PARALLEL TEAM CEILING');

  // A local provider carries a scan button — "RUN CAPACITY SCAN" before any
  // scan, "RE-SCAN CAPACITY" once one is saved. Either way, consent is a real
  // «NOTICE» gate (AC-8). A remote provider is honestly NOT MEASURABLE with no
  // button. Robust to whether a prior scan happens to be on disk.
  const measurable = await cap.locator('.rec-run').count();
  if (measurable) {
    await cap.locator('.rec-run').click();
    await expect(cap.locator('.rec-confirm-msg')).toContainText('«NOTICE»');
    await expect(cap.locator('.rec-confirm-msg')).toContainText('real requests through the substrate');
    await cap.locator('.rec-btn', { hasText: 'CANCEL' }).click();
    await expect(cap.locator('.rec-confirm-msg')).toHaveCount(0);
  } else {
    await expect(cap).toContainText('NOT MEASURABLE');
  }

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('TERMINAL: opens an xterm and a live shell prints output', async ({ page }) => {
  await openDockApp(page, 'TERMINAL');
  await expect(page.locator('.terminal-stage .xterm')).toBeVisible({ timeout: 20000 });
  // The PTY's first prompt/banner arrives over the WS within a few seconds.
  await expect(page.locator('.terminal-stage')).toContainText(/[$#%>~@]/, { timeout: 20000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('TERMINAL: surfaces the backend terminal:error when the PTY cap is hit', async ({ page }) => {
  // Saturate the backend's MAX_TERMINALS cap (10) with raw terminal sockets
  // from the page — each held open until its PTY proves alive (first
  // terminal:data frame). The 11th terminal (the dock app) must then show the
  // backend's own refusal instead of sitting silently dead.
  try {
    await page.evaluate(async () => {
      const t = sessionStorage.getItem('authToken') || '';
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      window.__satSockets = [];
      await Promise.all(Array.from({ length: 10 }, () => new Promise((resolve, reject) => {
        const ws = new WebSocket(`${proto}//${location.host}/terminal-ws?token=${encodeURIComponent(t)}`);
        window.__satSockets.push(ws);
        const bail = setTimeout(() => reject(new Error('saturating PTY never spoke')), 15000);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'terminal:data' || msg.type === 'terminal:error') {
              clearTimeout(bail);
              resolve();
            }
          } catch { /* non-JSON frame — keep waiting */ }
        };
        ws.onerror = () => { clearTimeout(bail); reject(new Error('saturating socket errored')); };
      })));
    });

    await openDockApp(page, 'TERMINAL');
    await expect(page.locator('.terminal-stage')).toContainText('Too many terminals open', { timeout: 20000 });
    expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
  } finally {
    // Free the cap for whatever runs next — disconnect kills each PTY.
    await page.evaluate(() => {
      for (const ws of window.__satSockets || []) { try { ws.close(); } catch { /* closing */ } }
      delete window.__satSockets;
    }).catch(() => {});
  }
});

test('SETTINGS: THE PRESS shows the kit board and presses markdown to a real PDF download', async ({ page }) => {
  await openDockApp(page, 'SETTINGS');

  const settings = page.locator('.settings');
  await expect(settings.locator('.settings-h', { hasText: 'THE PRESS' })).toBeVisible();

  // The board answers with the real kit state — the KITS row renders whether
  // or not any kit is configured on this machine.
  const pressCard = settings.locator('.settings-realm', { has: page.locator('.settings-k', { hasText: 'KITS' }) });
  await expect(pressCard.locator('.settings-k', { hasText: 'KITS' })).toBeVisible();

  // Press real markdown through the real backend (real Chromium) to a real
  // browser download — the whole witness flow, no shortcuts.
  await pressCard.locator('textarea').fill('# E2E Press\n\nPressed from the desk.');
  await pressCard.locator('input[placeholder*="Document title"]').fill('E2E Press');
  const download = page.waitForEvent('download');
  await pressCard.locator('.settings-set', { hasText: 'PRESS TO PDF' }).click();
  expect((await download).suggestedFilename()).toBe('e2e-press.pdf');

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SETTINGS: the LOOK tab dresses the platform — knobs, presets, persistence', async ({ page }) => {
  // Ground truth first, restored at the end — this test must leave the
  // witness's dress exactly as it found it.
  const authed = { Authorization: `Bearer ${token}` };
  const sweepShelf = async () => {
    const { presets } = await (await fetch(`${BACKEND}/api/v1/look`, { headers: authed })).json();
    for (const p of presets ?? []) {
      if (p.name === 'E2E DUSK') {
        await fetch(`${BACKEND}/api/v1/look/presets/${p.id}`, { method: 'DELETE', headers: authed });
      }
    }
  };
  await sweepShelf(); // a prior failed run must not leave a double on the shelf
  const before = await (await fetch(`${BACKEND}/api/v1/look`, { headers: authed })).json();
  const cssSignal = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--signal').trim());

  try {
    await openDockApp(page, 'SETTINGS');
    await page.locator('.settings-tab', { hasText: 'LOOK' }).click();

    const settings = page.locator('.settings');
    await expect(settings.locator('.settings-h', { hasText: 'THE LOOK' })).toBeVisible();
    // The five knobs stand, each with a swatch and a hex field. Rows match
    // by their exact LABEL — a hint mentioning another knob must not blur
    // the filter (HEAD's hint speaks of body ink).
    for (const knob of ['GROUND', 'PANEL', 'INK', 'TRIM', 'HEAD']) {
      const row = settings.locator('.settings-look-row', {
        has: page.locator('.settings-k', { hasText: new RegExp(`^${knob}$`) }),
      });
      await expect(row.locator('.settings-look-swatch')).toBeVisible();
      await expect(row.locator('.settings-look-hex')).toBeVisible();
    }

    // One click on a stock dress re-colors the platform LIVE — the derived
    // trim token lands as an inline override on the document root…
    await settings.locator('.settings-look-preset', { hasText: 'EMBER' }).click();
    await expect.poll(cssSignal).toBe('#FF7A45');
    // EMBER claims its registers — the ALERT family lands with the dress.
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--alert').trim()),
    ).toBe('#FF4A3D');

    // …and persists to the canonical store once the debounce settles.
    await expect.poll(async () =>
      (await (await fetch(`${BACKEND}/api/v1/look`, { headers: authed })).json()).theme?.trim,
    ).toBe('#FF7A45');

    // A knob speaks too: commit a hex through the TRIM field, the token follows.
    const trimRow = settings.locator('.settings-look-row', {
      has: page.locator('.settings-k', { hasText: /^TRIM$/ }),
    });
    await trimRow.locator('.settings-look-hex').fill('#00CC88');
    await trimRow.locator('.settings-look-hex').press('Enter');
    await expect.poll(cssSignal).toBe('#00CC88');
    // A deliberate act persists immediately — the store holds it before any exit.
    await expect.poll(async () =>
      (await (await fetch(`${BACKEND}/api/v1/look`, { headers: authed })).json()).theme?.trim,
    ).toBe('#00CC88');

    // Save the current dress under the witness's own name — it lands on the shelf.
    await settings.locator('input[placeholder="Name this dress"]').fill('E2E DUSK');
    await settings.locator('.settings-set', { hasText: 'SAVE' }).click();
    await expect(settings.locator('.settings-look-preset', { hasText: 'E2E DUSK' })).toBeVisible();

    // The dress survives a full re-entry — the mirror paints before auth,
    // the canonical store corrects behind it.
    await page.goto('/?noboot=1');
    await expect.poll(cssSignal).toBe('#00CC88');

    // Back to stock through the real UI: delete the shelf entry, choose VOID.
    const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
    if (await standAside.isVisible({ timeout: 5000 }).catch(() => false)) await standAside.click();
    await openDockApp(page, 'SETTINGS');
    await page.locator('.settings-tab', { hasText: 'LOOK' }).click();
    const shelfRow = page.locator('.settings-look-presets li', { hasText: 'E2E DUSK' });
    await shelfRow.locator('.settings-backup-del').click();
    await expect(page.locator('.settings-look-preset', { hasText: 'E2E DUSK' })).toHaveCount(0);
    await page.locator('.settings-look-preset', { hasText: 'VOID' }).click();
    // VOID clears the override entirely — the stock stylesheet stands again,
    // and the claimed registers RELEASE (no stale --alert left behind).
    await expect.poll(cssSignal).toBe('');
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--alert').trim()),
    ).toBe('');
    await expect.poll(async () =>
      (await (await fetch(`${BACKEND}/api/v1/look`, { headers: authed })).json()).theme,
    ).toBeNull();
  } finally {
    // Leave the dress and the shelf as found, whatever happened above.
    await sweepShelf();
    await fetch(`${BACKEND}/api/v1/look/theme`, {
      method: 'PUT',
      headers: { ...authed, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: before.theme ?? null }),
    });
  }

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SWITCHER: an on-chain seat stands beside the name once the founding record holds it', async ({ page }) => {
  // The founding record is chain truth persisted at the workspaces root —
  // this test writes a SYNTHETIC one, so it only ever runs against a
  // disposable (tmp-root) stack, never a witness's real root.
  const authed = { Authorization: `Bearer ${token}` };
  const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, { headers: authed })).json();
  const activeRoot = sec?.roots?.active || '';
  test.skip(!activeRoot.startsWith(os.tmpdir()),
    'workspaces root is not disposable — a synthetic founding record must never land on a real root');

  const soulAddress = '0xA11CE00000000000000000000000000000000E2E';
  const sealPath = path.join(activeRoot, 'e2e-desk', 'identity', 'onchain-seal.json');
  const recordPath = path.join(activeRoot, 'house-founding.base.json');
  await fs.promises.mkdir(path.dirname(sealPath), { recursive: true });
  await fs.promises.writeFile(sealPath, JSON.stringify({ soulAddress }));
  await fs.promises.writeFile(recordPath, JSON.stringify({
    schema: 'neuma-house-founding/1', houseName: 'E2eHouse', houseId: '0x1',
    network: 'base', members: [{ address: soulAddress, kind: 1, title: 'Quaestor' }],
  }));
  try {
    // The switcher stands only when the cached roster holds two beings —
    // seed the cache (the spec's established pattern) and re-land so the
    // button mounts. The TITLE is deliberately NOT seeded: it must arrive
    // through the real roster endpoint the switcher refreshes on open.
    await page.evaluate(({ a }) => {
      localStorage.setItem(`${a.toLowerCase()}:neuma-roster`, JSON.stringify({
        roster: [{ neumaId: 'e2e-desk', name: 'Fenna' }],
        witnesses: [{ neumaId: 'witness-e2e-Seed', name: 'Seed', participantKind: 'witness' }],
      }));
    }, { a: addr });
    await page.goto('/?noboot=1');
    const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
    if (await standAside.isVisible({ timeout: 5000 }).catch(() => false)) await standAside.click();

    await page.locator('.being-switcher-btn').click();
    const row = page.locator('.being-switcher-row', { hasText: 'E2E-DESK' });
    await expect(row.locator('.being-switcher-title')).toHaveText('QUAESTOR');
    // The seat is quiet data beside the name, not a duplicate row.
    await expect(page.locator('.being-switcher-title')).toHaveCount(1);
    // The section heads are HEADINGS, not rows: a step larger than the
    // 10px rows and carrying the heading register's own color.
    const head = page.locator('.being-switcher-head', { hasText: 'NEUMA' });
    const headStyle = await head.evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, color: s.color, cursor: s.cursor };
    });
    expect(headStyle.size).toBe('11px');
    expect(headStyle.color).toBe('rgba(255, 255, 255, 0.7)'); // stock --color-heading
    expect(headStyle.cursor).toBe('default');
  } finally {
    await fs.promises.rm(recordPath, { force: true });
    await fs.promises.rm(sealPath, { force: true });
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('TASKBAR: the launcher and the tray stay reachable at a narrow viewport', async ({ page }) => {
  // The overflow proof, carried over from the dock: at a narrow width the bar
  // never pushes its launcher or its tray off-screen, and the launcher panel
  // opens wholly inside the viewport.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.taskbar')).toBeVisible();
  const launcher = page.locator('.taskbar-launcher');
  await expect(launcher).toBeInViewport();
  await expect(page.locator('.taskbar-clock')).toBeInViewport();
  await launcher.click();
  await expect(page.locator('.launcher')).toBeInViewport();
  await expect(page.locator('.launcher-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.launcher')).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('LAUNCHER: a category shows its apps; one launches, lands on the bar, and the launcher closes', async ({ page }) => {
  // The core interaction, on the taskbar: the launcher shows every app under
  // what it is for — KNOW holds the record and the maps, never the stream.
  await page.locator('.taskbar-launcher').click();
  const know = page.locator('.launcher-section[data-category="know"]');
  await expect(know).toBeVisible();
  await expect(know.locator('.launcher-tile', { hasText: 'RECORD' })).toBeVisible();
  await expect(know.locator('.launcher-tile', { hasText: 'REPO MAP' })).toBeVisible();
  await expect(know.locator('.launcher-tile', { hasText: 'DATA' })).toBeVisible();
  await expect(know.locator('.launcher-tile', { hasText: 'STREAM' })).toHaveCount(0);

  // Launch → its window opens, the launcher closes, and the open app shows on the bar.
  await know.locator('.launcher-tile', { hasText: 'RECORD' }).click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page.locator('.launcher')).toHaveCount(0);
  await expect(page.locator('.taskbar-app.is-focused[data-app-id="sheet"]')).toBeVisible();

  // Escape closes the launcher without launching anything.
  await page.locator('.taskbar-launcher').click();
  await expect(page.locator('.launcher')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.launcher')).toHaveCount(0);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('DATA: the custody panel renders a being’s data integrity — encrypted, isolated, healthy', async ({ page }) => {
  // The DATA surface (KNOWLEDGE dock section) is read-only over existing
  // owner-gated endpoints — it proves custody (encryption/isolation), shows the
  // SHAPE of the store (counts), and never dumps private content. Robust whether
  // or not the focused companion resolves to a fully-populated being on this rig.
  await openDockApp(page, 'DATA');
  const data = page.locator('.data');
  await expect(data).toBeVisible();

  // The three custody lenses render.
  for (const h of ['CUSTODY', 'STORES', 'HEALTH']) {
    await expect(data.locator('.data-h', { hasText: h })).toBeVisible();
  }

  // The sovereignty framing is present — this is a custody view, not a content browser.
  await expect(data.locator('.data-note', { hasText: /sovereign workspace/ })).toBeVisible();

  // At least one real status tag resolves from the live owner-gated endpoints
  // (recovery posture + storage headroom render regardless of the focused being).
  await expect(data.locator('.data-tag').first()).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('SHIFT+\\: cycles the open windows — and never steals a typed pipe', async ({ page }) => {
  // Design note, 2026-07-27: the muscle memory from his editor, carried onto the desk.
  // He named the PHYSICAL `\|` key rather than a character.
  //
  // The second half is the one that matters most and can only be proven in a
  // real browser: Shift+\ IS the `|` character, so a handler that does not
  // stand down inside a text surface would steal every pipe typed into the
  // composer. A unit test cannot show that — it needs real focus and real
  // typing, which is why it lives here.
  await openDockApp(page, 'RECORD');
  await openDockApp(page, 'FILES');

  const focusedTitle = () => page.locator('.fwin.is-focused .fwin-bar-title').innerText();

  // Focus the desk chrome, not a field, then cycle. Focus must MOVE.
  await page.locator('.taskbar-fill').click();
  const before = await focusedTitle();
  await page.keyboard.press('Shift+Backslash');
  await expect.poll(focusedTitle).not.toBe(before);

  // Back the other way returns where we started — the cycle is a loop.
  await page.keyboard.press('Control+Shift+Backslash');
  await expect.poll(focusedTitle).toBe(before);

  // THE GUARD. In the composer, Shift+\ must type a pipe and move nothing.
  const composer = page.locator('.relink-input-field').first();
  await composer.click();
  const held = await focusedTitle();
  await composer.fill('');
  await page.keyboard.type('a');
  await page.keyboard.press('Shift+Backslash');
  await page.keyboard.type('b');
  await expect(composer).toHaveValue('a|b');   // the pipe was typed
  await expect.poll(focusedTitle).toBe(held);  // and focus never moved
  await composer.fill('');

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
