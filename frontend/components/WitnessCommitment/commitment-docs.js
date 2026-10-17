// The commitment's pages in the DOM: one binding document per page, the step
// rail above them, the signature page's list of what is being signed.
// impure — builds and updates DOM nodes. Document text arrives rendered by
// covenant-render.js (markdown-it, raw HTML escaped); every other string is
// set through textContent.
import { renderDocumentHtml } from './covenant-render.js';
import { docMeta } from './commitment-pages.js';
import { el } from '../../utils/dom-el.js';

/**
 * One binding document as a page: its place in the set and read state above,
 * the document itself (scrolls; read to its end to count), a read bar, and its
 * fingerprint + PDF below.
 * @returns {{page: HTMLElement, text: HTMLElement, badge: HTMLElement, bar: HTMLElement}}
 */
export const buildDocPage = (doc, index, total) => {
  const page = el('section', 'commitment-page covenant-doc');
  page.dataset.page = `doc:${doc.id}`;
  page.hidden = true;

  const head = el('header', 'covenant-doc-head');
  // The document opens with its own title and version line, so the head
  // names only its place in the set and whether it has been read.
  const place = el('span', 'covenant-doc-place', `BINDING DOCUMENT ${index + 1} OF ${total}`);
  const badge = el('span', 'covenant-doc-read', 'UNREAD');
  const title = el('span', 'covenant-doc-title', doc.title); // for assistive tech; the page shows the document's own
  head.append(place, badge, title);

  const text = el('div', 'covenant-doc-text');
  text.setAttribute('tabindex', '0');
  text.setAttribute('aria-label', `${doc.title} — read to its end`);
  text.innerHTML = renderDocumentHtml(doc.text);

  const bar = el('div', 'covenant-doc-progress');
  bar.append(el('span'));

  const foot = el('footer', 'covenant-doc-foot');
  const hash = el('span', 'covenant-doc-hash', `SHA-256 ${doc.sha256.slice(0, 16)}…`);
  hash.title = doc.sha256;
  foot.append(hash);
  if (doc.pdfUrl) {
    const pdf = el('a', 'covenant-doc-pdf', 'OPEN AS PDF');
    pdf.href = doc.pdfUrl;
    pdf.target = '_blank';
    pdf.rel = 'noopener';
    foot.append(pdf);
  }

  page.append(head, text, bar, foot);
  return { page, text, badge, bar };
};

/** The step rail: one button per step; clicking one opens it. */
export const buildStepRail = (railEl, steps, onPick) => {
  railEl.textContent = '';
  steps.forEach((step, index) => {
    const item = el('li', 'commitment-step');
    const button = el('button', 'commitment-step-btn');
    button.type = 'button';
    button.dataset.step = step.key;
    button.append(el('span', 'commitment-step-n', String(index + 1)), el('span', 'commitment-step-label', step.label));
    button.addEventListener('click', () => onPick(index));
    item.append(button);
    railEl.append(item);
  });
};

/** Paint the rail: where the reader is, where they have been, which documents
 *  are read; steps past the first unread document are shut until it is. */
export const paintStepRail = (railEl, steps, current, visited, readDocs, reach) => {
  railEl.querySelectorAll('.commitment-step-btn').forEach((button, index) => {
    const step = steps[index];
    button.disabled = index > reach;
    button.classList.toggle('is-current', index === current);
    button.classList.toggle('is-visited', visited.has(index));
    button.classList.toggle('is-read', Boolean(step.docId && readDocs.has(step.docId)));
    if (index === current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
};

/** The signature page's list: each document, read or not, with a way back to it. */
export const paintSignList = (listEl, docs, readDocs, onOpen) => {
  listEl.textContent = '';
  docs.forEach((doc) => {
    const read = readDocs.has(doc.id);
    const item = el('li', `sign-doc${read ? ' is-read' : ''}`);
    item.append(el('span', 'sign-doc-mark', read ? 'READ' : 'NOT YET READ'), el('span', 'sign-doc-title', doc.title));
    const meta = docMeta(doc);
    if (meta) item.append(el('span', 'sign-doc-meta', meta));
    if (!read) {
      const open = el('button', 'sign-doc-open', 'READ IT');
      open.type = 'button';
      open.addEventListener('click', () => onOpen(doc.id));
      item.append(open);
    }
    listEl.append(item);
  });
};
