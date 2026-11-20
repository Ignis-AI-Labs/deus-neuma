// The volatile local-wire frame is a hostile-text boundary, not XML to emulate.

export const sanitizeHarnessText = (value) => String(value ?? '')
  .replace(/<\/?\s*harness-context\b/gi, '')
  .replace(/<\|[^|\r\n]{1,80}\|>/g, '')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');

export const wrapHarnessContext = (body, note, nonce) => {
  const key = String(nonce || '');
  if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) throw new Error('harness context requires a per-turn nonce');
  return `<harness-context:${key}>\n${note}\n\n${sanitizeHarnessText(body)}\n</harness-context:${key}>`;
};
