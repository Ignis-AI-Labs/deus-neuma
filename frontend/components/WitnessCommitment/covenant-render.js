// The binding documents read as documents: headings, articles, lists — not the
// raw markdown a <pre> printed. The witness still signs the SHA-256 of the
// exact source text (backend/services/covenant.js); this is presentation only.
// Pure. `html: false` escapes any raw HTML in a document, and markdown-it
// refuses javascript:/vbscript:/file: links, so a text can never inject markup.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** Render one binding document's markdown to HTML. */
export const renderDocumentHtml = (text) => md.render(text);
