// Tab gestures for e2e — real HTML5 drags with the mouse, step by step.
//
// THE DELIBERATE TEAR-OUT (ruling, 2026-10-05): a sitting gets its own window only
// by being dragged OUT of the window it lives in and let go there — there is no
// pop-out button. `tearOut` is that gesture: it carries the tab to the desk's
// top status strip, which no window ever covers (snapped and maximized windows
// fill the bounds BELOW it), and lets go. `dropInside` carries it into its own
// window's body instead — the release that must change nothing.
//
// `dragTo` moves in one hop, which Chromium does not always read as a drag, so
// both move in steps, away from the origin first (a drag does not start until
// the pointer leaves it).

const carry = async (page, tab, to) => {
  const from = await tab.boundingBox();
  if (!from) throw new Error('the tab is not on screen');
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx + 12, fy + 4, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.move(to.x, to.y, { steps: 4 }); // settle where it is let go
  await page.mouse.up();
};

/** Drag a tab out of its window and let go on the desk — it becomes its own window. */
export const tearOut = async (page, tab) => {
  const { width } = page.viewportSize();
  await carry(page, tab, { x: width / 2, y: 4 });
};

/** Drag a tab into the middle of its own window's body and let go — nothing happens. */
export const dropInside = async (page, tab) => {
  const win = tab.locator('xpath=ancestor::section[contains(concat(" ", @class, " "), " fwin ")]');
  const box = await win.boundingBox();
  if (!box) throw new Error('the tab has no window on screen');
  await carry(page, tab, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
};
