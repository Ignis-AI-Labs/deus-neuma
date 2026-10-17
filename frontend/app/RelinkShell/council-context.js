// council-context.js — share THE COUNCIL's state across the desk.
//
// The council stream lives at the desk host, ABOVE the window manager
// (the same law as the consciousness stream: one stream state, many
// windows), so the sitting survives the COUNCIL window closing and any
// future surface can read the same room.

import { createContext, useContext } from 'react';

export const CouncilContext = createContext(null);

export const useCouncil = () => useContext(CouncilContext);
