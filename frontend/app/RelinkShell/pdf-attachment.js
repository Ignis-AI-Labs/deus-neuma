/** PDF documents use the existing text attachment wire; bytes stay in-browser. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 1000; // the character ceiling and the turn's room are the real bounds

/** Pure — MIME or extension, including PDFs from browsers with no MIME hint. */
export const isPdf = (file) => file?.type?.toLowerCase() === 'application/pdf'
  || /\.pdf$/i.test(file?.name || '');

/** impure — lazy worker parsing, bounded text extraction, always release resources. */
export const fileToPdfText = async (file, maxChars) => {
  if (file.size > MAX_PDF_BYTES) throw new Error('That PDF is over the 20MB limit.');
  // Electron 33 lacks Uint8Array.toHex; the legacy worker includes its polyfill.
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`That PDF has more than ${MAX_PDF_PAGES} pages. Share a smaller section.`);
    const pages = [];
    let length = 0;
    let hasText = false;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.filter((item) => typeof item.str === 'string')
        .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').trim();
      hasText ||= Boolean(text);
      const section = `[Page ${number}]\n${text}`;
      length += section.length + (pages.length ? 2 : 0);
      if (length > maxChars) throw new Error(`That PDF exceeds the ${Math.round(maxChars / 1000)}k-character document limit. Share a smaller section.`);
      pages.push(section);
      page.cleanup();
    }
    if (!hasText) throw new Error('This PDF has no selectable text. For scanned pages, use a searchable PDF or share the pages as images.');
    return pages.join('\n\n');
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('This PDF is password-protected. Share an unlocked copy.', { cause: error });
    if (error.name === 'InvalidPDFException') throw new Error('This PDF could not be read. Try exporting a new copy.', { cause: error });
    throw error;
  } finally {
    await loading.destroy();
  }
};
