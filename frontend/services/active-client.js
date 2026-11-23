// active-client — everything running for the house right now (backend services/active-work.js). impure.
import { authedCall } from './authed-call.js';

const tasksCall = authedCall('/api/v1/tasks');

/** @returns {Promise<{active: Array<{id: string, kind: string, title: string, detail: string, since: string, last: string[], open: object}>}>} */
export const getActiveWork = () => tasksCall('GET', '/active', { errorPrefix: 'Could not read what is running' });
