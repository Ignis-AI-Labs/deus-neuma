// stream-reducer-kit.js — the fold helpers every stream-reducer suite
// shares (split from stream-reducer.test.js, SIZE-033). The reducer is pure:
// no IO, no clocks.

import {
  reducer, initialState,
} from '../../frontend/app/RelinkShell/stream-reducer.js';

// Fold a sequence of actions over the initial state.
export const run = (actions, start = initialState) => actions.reduce(reducer, start);

export const streamingMsg = (state) => state.messages.find((m) => m.streaming);
export const firstTool = (msg) => msg.segments.find((s) => s.kind === 'tool');
