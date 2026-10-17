// docx-text — a Word document as its words, read from a real .docx written
// byte by byte (test/helpers/docx-fixture.js); Node's own zlib inflates it.
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { docxText, docxXmlToText } from '../../core/documents/docx-text.js';
import { docxSaying } from '../helpers/docx-fixture.js';

const read = (bytes) => docxText(new Uint8Array(bytes), inflateRawSync);

describe('docxText', () => {
  it('paragraphs become lines, runs join, entities decode', async () => {
    const text = await read(docxSaying(['Quarterly report', ['Revenue ', 'rose &amp; costs fell'], 'Q&#x2019;s close']));
    expect(text).toBe('Quarterly report\nRevenue rose & costs fell\nQ’s close');
  });

  it('tabs and line breaks inside a paragraph are kept; empty paragraphs drop', () => {
    const xml = '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p><w:p/><w:p><w:r><w:t> </w:t></w:r></w:p>';
    expect(docxXmlToText(xml)).toBe('a\tb\nc');
  });

  it('a file that is not a .docx is refused with a reason, never read as noise', async () => {
    await expect(read(Buffer.from('{\\rtf1 an old doc}'))).rejects.toThrow(/not a Word document/);
  });
});
