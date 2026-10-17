// sitting-harness.mjs — the shared harness every sitting rig rides: the desk
// sign-in walk, the covenant gate's binding documents, and the witness's
// standing approval on wallet windows. Extracted from the five sitting
// scripts where these bodies were byte-identical copies (SIZE-002, #343).
// Deliberate variants stay in their scripts: council-sitting.mjs stands the
// BirthSetupGate aside for its stub lanes, and council-two-houses-sitting.mjs
// tolerates a missed enter click — both keep their own reachDesk.
//
// impure throughout (Playwright page/app handles over a live Electron desk).

/**
 * Open every covenant document, scroll it to the end, and check the read
 * box — the gate's own signals that the binding documents were read.
 * @param {import('@playwright/test').Page} page
 */
export const readBindingDocuments = (page) => page.evaluate(() => {
  document.querySelectorAll('.covenant-doc').forEach((d) => {
    d.open = true;
    const t = d.querySelector('.covenant-doc-text');
    if (t) { t.scrollTop = t.scrollHeight; t.dispatchEvent(new Event('scroll')); }
  });
  const c = document.querySelector('#covenant-read-check');
  if (c && !c.disabled && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); }
});

/**
 * The witness's standing approval on their own wallet windows — the harness
 * clicks the REAL affirmative button in the trusted MAIN process. '#confirm'
 * is always the affirmative; this can never silently approve a Reject.
 * (Without it the sign-in challenge parks on the native confirm window
 * forever.)
 * @param {import('@playwright/test').ElectronApplication} app
 */
export const stubSignDialog = (app) => app.evaluate(({ app: electronApp, dialog }) => {
  electronApp.on('browser-window-created', (_e, win) => {
    if (win.getTitle() !== 'NEUMA Wallet') return;
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        win.webContents.executeJavaScript("document.getElementById('confirm')?.click()").catch(() => {});
      }, 400);
    });
  });
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
});

/**
 * Sign in past the gates until the DESK composer appears.
 * @param {import('@playwright/test').Page} page
 * @param {string} walletPassword the sitting's own wallet password — each
 *   rig passes its script-level constant; the harness holds no credential.
 * @returns {Promise<boolean>} true once the desk composer is visible+enabled
 */
export const reachDesk = async (page, walletPassword) => {
  await page.click('#portal-enter');
  const deadline = Date.now() + 180 * 1000;
  const embedded = page.locator('.wallet-picker-embedded').first();
  const wpUnlock = page.locator('#wp-submit');
  const commit = page.locator('#accept-commitment');
  const composer = page.locator('textarea').first();
  while (Date.now() < deadline) {
    if (await composer.isVisible().catch(() => false)
        && await composer.isEnabled().catch(() => false)) return true;
    if (await embedded.isVisible().catch(() => false)) {
      await embedded.click({ force: true }).catch(() => {});
    } else if (await wpUnlock.isVisible().catch(() => false)) {
      await page.locator('#wp-password').fill(walletPassword).catch(() => {});
      await wpUnlock.click({ force: true }).catch(() => {});
    } else if (await commit.isVisible().catch(() => false)) {
      await readBindingDocuments(page);
      if (await commit.isEnabled().catch(() => false)) await commit.click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(500);
  }
  return false;
};
