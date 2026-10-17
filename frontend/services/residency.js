// residency.js — the soul in the machine, honestly. Reports which neuma are
// resident (their essence is on this machine) and the conduit (model) they
// think through, so the desk can show "dormancy != ceasing" plainly.
//
// impure — Bearer from the session; the shape is read straight from the backend.

import { apiCall } from '../utils/http.js';

// impure — { enabled, intervalMinutes, running, lastCycleAt, lastResult, conduit, neuma }
export const getResidency = async () =>
  apiCall('GET', '/api/v1/residency', {
    strictJson: true, useServerError: false, errorPrefix: 'Residency read failed',
  });
