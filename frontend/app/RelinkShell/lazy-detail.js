// lazy-detail.js — find, in one point's full rows, the part the display view
// left out: a take's thought text or tool detail, or the asking's pasted image.
//
// pure — rows and an address in, the text (or data URL) out; null when the
// record no longer holds it (never an invented stand-in).

/**
 * @param {Array<object>} rows - the point's full rows (turn-detail-client.js)
 * @param {{part: 'thought'|'tool'|'image', take?: number, index: number}} ref
 * @returns {?string}
 */
export const pickLazy = (rows, ref) => {
  const list = Array.isArray(rows) ? rows : [];
  if (ref?.part === 'image') {
    const asking = list.find((r) => r?.role === 'user' && Array.isArray(r.images) && typeof r.images[ref.index] === 'string');
    return asking ? asking.images[ref.index] : null;
  }
  const take = list.filter((r) => r?.role === 'assistant')[(ref?.take ?? 1) - 1];
  if (!take) return null;
  if (ref.part === 'thought') {
    const text = take.thoughts?.[ref.index]?.text;
    return typeof text === 'string' ? text : null;
  }
  const detail = take.tools?.[ref.index]?.detail;
  return typeof detail === 'string' ? detail : null;
};
