// composition-context.js — share the latest context:composition event.
//
// The composition hook lives at the desk host (a sibling of the
// consciousness stream on the SAME wsService — never a second socket) so
// the latest event outlives the CONTEXT MAP window: close and reopen the
// window mid-session and the last observed anatomy is still there.

import { createContext, useContext } from 'react';

export const CompositionContext = createContext(null);

export const useCompositionEvent = () => useContext(CompositionContext);
