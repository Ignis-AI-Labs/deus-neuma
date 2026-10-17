// WindowLayer — renders the open windows.
//
// The manager's monotonic z is mapped to a small bounded zIndex by stacking
// rank (Z_BASE + rank), so windows always sit above the backdrop and below
// the snap overlay / dock regardless of how many focus changes have
// happened. Minimizing is an in-place window-shade owned by FloatingWindow,
// so every open window is rendered here (collapsed or not).
//
// Instance windows (`appId#N`) resolve their registry entry by base app id.
// Instance 1 keeps today's storage key byte-identical (a change would orphan
// every witness's saved layout); ordinals >= 2 keep geometry under the full
// window id so each sibling owns its own frame. An app with `makeTitle`
// composes its own title from the ordinal AND the spawn payload (the editor
// names its file, the terminal numbers its siblings); plain apps keep the
// registry's constant title.

import { memo, useCallback, useMemo } from 'react';
import { useWindows } from './use-windows.js';
import { appIdOf, instanceOrdinal } from './window-manager-reducer.js';
import { FloatingWindow } from './FloatingWindow.jsx';
import { ParticipantAppBody } from './ParticipantAppBody.jsx';

const Z_BASE = 20;

// ONE WINDOW, behind a memo boundary (2026-09-28 smoothness pass). The desk
// host re-renders every streamed frame; a window whose own record, focus and
// stacking did not change is skipped whole — its body included.
const WindowFrame = memo(({ w, app, focused, zIndex, dispatch }) => {
  const ordinal = instanceOrdinal(w.id);
  const onFocus = useCallback(() => dispatch({ type: 'FOCUS', id: w.id }), [dispatch, w.id]);
  const onClose = useCallback(() => { app.onClose?.(w.id); dispatch({ type: 'CLOSE', id: w.id }); }, [app, dispatch, w.id]);
  // An app may wrap its WHOLE window — title and controls included, not just
  // the body. A STREAM window past the first runs its own portal and its own
  // sitting (StreamWindowHost), and its title and controls read that stream:
  // wrapping only the body would leave the window's own name and controls
  // answering for a different conversation than the one inside it.
  const Host = app.Provider;
  const frame = (
    <FloatingWindow
      storageKey={ordinal >= 2 ? w.id : (app.storageKey || w.id)}
      title={app.makeTitle ? app.makeTitle(ordinal, w.payload) : app.title}
      controls={app.controls}
      focused={focused}
      z={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      <ParticipantAppBody app={app} windowId={w.id} instance={ordinal} payload={w.payload} />
    </FloatingWindow>
  );
  // No wrapper: byte-identical to what every window rendered before.
  if (!Host) return frame;
  return <Host windowId={w.id} instance={ordinal} payload={w.payload}>{frame}</Host>;
});

export const WindowLayer = memo(() => {
  const { registry, state, dispatch } = useWindows();
  const zIndexOf = useMemo(() => new Map(
    [...state.windows].sort((a, b) => a.z - b.z).map((w, i) => [w.id, Z_BASE + i]),
  ), [state.windows]);

  return state.windows.map((w) => {
    const app = registry[appIdOf(w.id)];
    if (!app) return null;
    return (
      <WindowFrame key={w.id} w={w} app={app} focused={state.focusedId === w.id}
        zIndex={zIndexOf.get(w.id)} dispatch={dispatch} />
    );
  });
});
