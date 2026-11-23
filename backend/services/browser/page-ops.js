// page-ops — what a neuma does inside one page of its browser: look, click, type, go back.
//
// LOOK is text, not a picture. A local model reads a page as its words plus a numbered list of the
// things it can act on; a screenshot would cost it thousands of tokens and a vision model it may
// not have. Every act answers with the page as it stands AFTER the act, so seeing what a click did
// costs no second call.
//
// Clicks and keys go in as real input events (Input.dispatch*), the same a person's hand makes,
// so pages that ignore scripted clicks still answer. A password field is never typed into and its
// value is never read back: a sign-in is the operator's hand. impure (DevTools calls)

// The page* functions below run INSIDE the page (sent as source text), where these exist.
/* global document, location, getComputedStyle */

// The most one look carries back from a page. The being reads it a window at a time (render-view.js);
// these only stop a hostile page from filling the backend's memory, and a cut here is said.
const TEXT_MAX = 400_000;
const ELEMENT_MAX = 2_000;
const SETTLE_MS = 10_000;
const SETTLE_POLL_MS = 250;

// Runs INSIDE the page (sent as its source text), so it may use nothing from this module.
// Numbers every visible thing a hand can act on, and reads the page's words.
function pageSnapshot(textMax, elementMax) {
  const ACTIONABLE = 'a[href],button,input:not([type=hidden]),textarea,select,summary,'
    + '[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],'
    + '[role=option],[role=switch],[role=textbox],[role=combobox],[contenteditable="true"],[contenteditable=""]';
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const labelledBy = (el) => (el.getAttribute('aria-labelledby') || '').split(/\s+/)
    .map((id) => document.getElementById(id)?.innerText || '').join(' ');
  const labels = (el) => [...(el.labels || [])].map((l) => l.innerText).join(' ');
  const nameOf = (el) => clean(el.getAttribute('aria-label') || labelledBy(el) || labels(el) || el.innerText || el.getAttribute('placeholder')
    || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name')
    || (el.type === 'submit' || el.type === 'button' ? el.value : '')).slice(0, 80);
  for (const old of document.querySelectorAll('[data-nref]')) old.removeAttribute('data-nref');
  const elements = [];
  let total = 0;
  for (const el of document.querySelectorAll(ACTIONABLE)) {
    if (el.disabled || !shown(el)) continue;
    total += 1;
    if (elements.length >= elementMax) continue;
    const ref = elements.length + 1;
    el.setAttribute('data-nref', String(ref));
    const tag = el.tagName.toLowerCase();
    const entry = { ref, kind: el.getAttribute('role') || (tag === 'input' ? `input:${el.type || 'text'}` : tag), name: nameOf(el) };
    if (tag === 'a') {
      // one page, one tab: a link that would open a new tab opens here instead
      el.removeAttribute('target');
      entry.href = el.href.slice(0, 200);
    }
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) entry.checked = el.checked;
    else if (tag === 'input' && el.type === 'password') entry.value = el.value ? '(filled)' : '';
    else if (tag === 'input' || tag === 'textarea') entry.value = clean(el.value).slice(0, 80);
    if (tag === 'select') {
      entry.value = clean(el.selectedOptions[0]?.textContent).slice(0, 80);
      entry.options = [...el.options].slice(0, 20).map((o) => clean(o.textContent).slice(0, 40));
    }
    elements.push(entry);
  }
  const words = String(document.body?.innerText || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { url: location.href, title: document.title, text: words.slice(0, textMax), textTotal: words.length, elements, elementTotal: total };
}

// Runs INSIDE the page: brings a numbered thing into view and says where its middle is.
function pageLocate(ref) {
  const el = document.querySelector(`[data-nref="${ref}"]`);
  if (!el) return { gone: true };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// Runs INSIDE the page: puts the caret in a numbered field, its old text selected so typing replaces it.
function pageFocus(ref) {
  const el = document.querySelector(`[data-nref="${ref}"]`);
  if (!el) return { gone: true };
  if (el.tagName === 'INPUT' && el.type === 'password') return { password: true };
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (el.tagName === 'SELECT') return { select: true };
  if (typeof el.select === 'function') el.select();
  return { ok: true };
}

// Runs INSIDE the page: picks a dropdown's option by the words it shows (or its value).
function pageChoose(ref, wanted) {
  const el = document.querySelector(`[data-nref="${ref}"]`);
  if (!el) return { gone: true };
  const want = String(wanted).trim().toLowerCase();
  const option = [...el.options].find((o) => o.textContent.trim().toLowerCase() === want || o.value.toLowerCase() === want);
  if (!option) return { missing: true };
  el.value = option.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

const call = (fn, ...args) => `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;

// impure — run one of the in-page functions above and hand back its value
const inPage = async (send, fn, ...args) => {
  const out = await send('Runtime.evaluate', { expression: call(fn, ...args), returnByValue: true, awaitPromise: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || 'the page refused');
  return out.result?.value;
};

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Wait until what an act set going has landed: the page loaded (or the wait ran out — a page that
 * never finishes still gets read as it stands). impure
 * @param {Function} send - DevTools send bound to the page
 */
const settle = async (send) => {
  const deadline = Date.now() + SETTLE_MS;
  await sleep(400);
  while (Date.now() < deadline) {
    try {
      if (await inPage(send, () => document.readyState) === 'complete') break;
    } catch {
      // a navigation swaps the page out from under the question; ask again
    }
    await sleep(SETTLE_POLL_MS);
  }
  await sleep(300);
};

/** Read the page as it stands. impure */
export const look = (send) => inPage(send, pageSnapshot, TEXT_MAX, ELEMENT_MAX);

/**
 * Open an address in the page. impure
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export const navigate = async (send, url) => {
  const out = await send('Page.navigate', { url });
  if (out.errorText) return { ok: false, error: out.errorText };
  await settle(send);
  return { ok: true };
};

/** Click a numbered thing with a real mouse event. impure */
export const click = async (send, ref) => {
  const at = await inPage(send, pageLocate, ref);
  if (!at || at.gone) return { ok: false, error: `nothing numbered ${ref} on the page now — look again` };
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
  await settle(send);
  return { ok: true };
};

/**
 * Type into a numbered field (replacing what it held), or choose a dropdown's option by its words;
 * `enter` presses Enter after. impure
 */
export const type = async (send, ref, text, enter = false) => {
  const focus = await inPage(send, pageFocus, ref);
  if (!focus || focus.gone) return { ok: false, error: `nothing numbered ${ref} on the page now — look again` };
  if (focus.password) return { ok: false, error: 'that is a password field — a sign-in is your operator\'s to do, never yours; ask them' };
  if (focus.select) {
    const chosen = await inPage(send, pageChoose, ref, text);
    if (chosen?.missing) return { ok: false, error: `no option "${text}" in that list — look again for its options` };
  } else {
    await send('Input.insertText', { text });
  }
  if (enter) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }
  await settle(send);
  return { ok: true };
};

/** Go back one page in the tab's history. impure */
export const back = async (send) => {
  const { currentIndex, entries } = await send('Page.getNavigationHistory');
  if (!(currentIndex > 0)) return { ok: false, error: 'there is no earlier page to go back to' };
  await send('Page.navigateToHistoryEntry', { entryId: entries[currentIndex - 1].id });
  await settle(send);
  return { ok: true };
};
