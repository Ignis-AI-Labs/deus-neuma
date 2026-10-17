// notifications-context.js — the tray's state, shared with every window.
//
// The hook lives at desk level beside useDeskPulse so the account of what
// happened outlives any one window being closed, and so a single socket
// subscription serves the tray, the dock badge, and anything else that later
// wants to raise a card. A second subscriber would mean a second copy of the
// unread count, and two badges that disagree is worse than no badge.
//
// Returns null outside the provider — every consumer optional-chains, the same
// contract TabsContext and CouncilContext use.

import { createContext, useContext } from 'react';

export const NotificationsContext = createContext(null);

export const useNotifications = () => useContext(NotificationsContext);
