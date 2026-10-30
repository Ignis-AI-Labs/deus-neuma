// decoded-forms — the plain text an encoded run inside a text stands for. A key or a planted value
// travels base64-, base64url-, hex- or percent-encoded as easily as plain, and a reader that sees
// only the plain form is blind to it (re-audit 2026-10-29: NEW-M4 at the outbound door, NEW-L5 in
// the injected-value taint). Pure.

// a run this long of one alphabet can hide a key; shorter runs are words and ids
const BASE64_RUN = /[A-Za-z0-9+/_-]{24,}={0,2}/g;
const HEX_RUN = /(?:[0-9a-fA-F]{2}){16,}/g;

// pure — decoded bytes worth reading again: mostly printable text, not noise
const printable = (bytes) => {
  if (bytes.length < 12) return null;
  const text = bytes.toString('utf8');
  const plain = [...text].filter((c) => c >= ' ' && c <= '~').length;
  return plain / text.length >= 0.9 ? text : null;
};

// pure — the plain forms a text may carry inside it: its percent-decoding, and
// each base64 (either alphabet) or hex run decoded back to readable text.
export const decodedForms = (text) => {
  const forms = [];
  if (text.includes('%')) { try { forms.push(decodeURIComponent(text)); } catch { /* not percent-encoded */ } }
  for (const run of text.match(BASE64_RUN) || []) {
    const decoded = printable(Buffer.from(run, 'base64'));
    if (decoded) forms.push(decoded);
  }
  for (const run of text.match(HEX_RUN) || []) {
    const decoded = printable(Buffer.from(run, 'hex'));
    if (decoded) forms.push(decoded);
  }
  return forms;
};
