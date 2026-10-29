// use-api-credentials.js — Settings → API reads its boards ONCE and hands
// them to the credential map and to every section, so the map and the forms
// below it can never disagree after a save (each section's write calls the
// refresher it is given).
//
// impure — reads the platform; every read lands on its own, and a failed one
// is named beside the others rather than blanking them.

import { useCallback, useEffect, useState } from 'react';
import { getChannelBoard, getFlightTests } from '../../services/social-channels-client.js';
import { listServices } from '../../services/routing.js';
import { getEmailBoard } from '../../services/email-client.js';

/**
 * impure — { channels, tests, services, email, errors, refreshChannels,
 * retestChannels, refreshServices, refreshEmail }. A board still in flight is
 * null; `errors` holds each failed board's message by name.
 */
export const useApiCredentials = () => {
  const [channels, setChannels] = useState(null);
  const [tests, setTests] = useState(null);
  const [services, setServices] = useState(null);
  const [email, setEmail] = useState(null);
  const [errors, setErrors] = useState({});

  const note = (name, err) => setErrors((e) => ({ ...e, [name]: err ? err.message : null }));

  const refreshChannels = useCallback(() => getChannelBoard()
    .then((b) => { setChannels(b.channels); note('channels'); })
    .catch((e) => note('channels', e)), []);
  // The flight read is soft: a probe failure never blanks the keys it sits under.
  const retestChannels = useCallback(({ fresh = false } = {}) => getFlightTests({ fresh })
    .then((r) => setTests(r.tests))
    .catch(() => {}), []);
  const refreshServices = useCallback(() => listServices()
    .then((r) => { setServices(r.services); note('services'); })
    .catch((e) => note('services', e)), []);
  const refreshEmail = useCallback(() => getEmailBoard()
    .then((b) => { setEmail(b.account); note('email'); })
    .catch((e) => note('email', e)), []);

  useEffect(() => {
    refreshChannels();
    retestChannels();
    refreshServices();
    refreshEmail();
  }, [refreshChannels, retestChannels, refreshServices, refreshEmail]);

  return { channels, tests, services, email, errors, refreshChannels, retestChannels, refreshServices, refreshEmail };
};
