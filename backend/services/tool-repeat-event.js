/** Shared operator receipt for a call whose prior verdict was reused. */
import { operationReceiptLabel } from './operation-result.js';

/** Pure — preserve original timing; a held call has no new execution. */
export const toolRepeatEvent = (result) => Object.freeze({
  tool: result.tool,
  status: 'held',
  summary: `${result.tool} — repeat held; not run again`,
  detail: `${result.content || result.error || ''}${operationReceiptLabel(result)}`,
});
