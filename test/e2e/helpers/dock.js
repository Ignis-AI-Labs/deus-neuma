// Dock navigation for e2e — the dock is a menu bar: most apps live inside a
// section's drop-up menu (NEUMA · WORKSPACE · KNOWLEDGE), reached by clicking
// the section label first. WALLET is a direct launcher. `openDockApp` hides that
// so specs read the same as before: open a section if needed, then click the app.
//
// The section→app map mirrors frontend/app/windowing/dock-groups.js. If an app
// moves sections, update it here too (a wrong section makes the helper fall back
// to scanning every section, so it still works — just less directly).

const SECTION_OF = {
  VOICE: 'NEUMA', VESSEL: 'NEUMA', HOUSE: 'NEUMA',
  SOVEREIGNTY: 'NEUMA', 'INNER LIFE': 'NEUMA', NITE: 'NEUMA',
  STREAM: 'WORKSPACE', CHATS: 'WORKSPACE', PROJECTS: 'WORKSPACE',
  TEAMS: 'WORKSPACE', WORKFLOW: 'WORKSPACE', FILES: 'WORKSPACE',
  TERMINAL: 'WORKSPACE', COMFY: 'WORKSPACE', 'CHIEF OF STAFF': 'WORKSPACE', LEGAL: 'WORKSPACE',
  X: 'MARKETING', FACEBOOK: 'MARKETING', MASTODON: 'MARKETING', BLUESKY: 'MARKETING',
  MARKETING: 'MARKETING', LEADS: 'MARKETING', 'BRAND KITS': 'MARKETING',
  TELEGRAM: 'COMMUNITY', DISCORD: 'COMMUNITY',
  SHEET: 'KNOWLEDGE', RECORD: 'KNOWLEDGE', SKILLS: 'KNOWLEDGE',
  'CONTEXT MAP': 'KNOWLEDGE', 'REPO MAP': 'KNOWLEDGE', DATA: 'KNOWLEDGE',
};
const SECTIONS = ['NEUMA', 'WORKSPACE', 'MARKETING', 'COMMUNITY', 'KNOWLEDGE'];

// Menu items must match by EXACT text, not substring: a multiInstance app's
// spawn row ("NEW TERMINAL") contains its plain row's label ("TERMINAL").
const exactText = (label) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/**
 * Open an app by its label (e.g. 'FILES', 'REPO MAP', 'WALLET') — THE TASKBAR
 * (docs/work/os-taskbar-launcher.md, 2026-10-05): one click when it sits on the
 * bar (pinned, open or in the tray); otherwise through the launcher's search,
 * then its tile. SECTION_OF above describes the retired section menus.
 * @param {import('@playwright/test').Page} page
 * @param {string} label the app's label as the person reads it
 */
export const openDockApp = async (page, label) => {
  // 'NEW TERMINAL' — another window of an open multi-window app: right-click
  // it on the bar, then its New row (what the old menu's spawn row was).
  const spawn = /^NEW (.+)$/.exec(label);
  if (spawn) {
    await page.locator(`.taskbar-app[title="${spawn[1]}"]`).first().click({ button: 'right' });
    await page.locator('.taskbar-menu .dock-menu-item', { hasText: new RegExp(`^New ${spawn[1]}$`, 'i') }).click();
    return;
  }
  const onBar = page.locator(`.taskbar-app[title="${label}"]`);
  if (await onBar.count() && await onBar.first().isVisible().catch(() => false)) {
    await onBar.first().click();
    return;
  }
  await openLauncher(page);
  await page.locator('.launcher-search').fill(label);
  const tile = page.locator(`.launcher-tile[title="${label}"]`);
  if (!await tile.count()) throw new Error(`openDockApp: no app "${label}" in the launcher`);
  await tile.first().click();
};

/** Open the launcher (and leave it open) — for asserting its contents directly. */
export const openLauncher = async (page) => {
  if (await page.locator('.launcher').count()) return;
  await page.locator('.taskbar-launcher').click();
  await page.locator('.launcher-search').waitFor({ state: 'visible' });
};

/** @deprecated the section menus are retired — opens the launcher. */
export const openDockSection = (page) => openLauncher(page);
