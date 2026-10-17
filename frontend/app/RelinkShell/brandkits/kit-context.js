// kit-context — the one draft, published to whoever is editing it.
//
// The draft is read at four different depths at once: the rail counts its
// gaps, the field controls write into it, the type specimens read its faces,
// and the preview renders it. Prop-drilling `draft` and `editField` through
// four levels to reach a colour swatch is how a component tree gets rewritten
// every time a section is added — so it rides a context, the same way
// composition-context.js and project-context.js already do here.
//
// No logic lives here on purpose. `use-kit-draft.js` owns the state; this file
// only carries it.

import { createContext, useContext } from 'react';

export const KitContext = createContext(null);

/** The draft, its progress, and every way to change it.
 *  Throws rather than returning null: a control that renders outside the
 *  provider would silently do nothing, which is worse to debug than a crash. */
export const useKit = () => {
  const value = useContext(KitContext);
  if (!value) throw new Error('useKit() outside a KitContext provider');
  return value;
};
