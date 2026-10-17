// Tool-block display filter — pure, display-side only.
//
// Re-export only: the single source of truth lives in
// core/runtime/tool-stream-suppressor.js so the display path (this file's
// consumers) and the voice path (backend portal-stream) share one dialect
// table (issue #196). The import surface below is unchanged — display
// consumers need no changes.

export {
  createToolStreamFilter,
  stripToolBlocks,
  extractToolLabel,
} from '../../core/runtime/tool-stream-suppressor.js';
