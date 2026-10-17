// use-kit-spec — the form's shape and the vendored faces, fetched once.
//
// Both are PROCESS CONSTANTS: the form is generated from KIT_SECTIONS at
// import time on the server, and the face registry is the set of files this
// build ships. Neither changes while a server runs, so fetching them per mount
// would be two round trips every time somebody opens the window.
//
// Memoized at MODULE level rather than in the hook, so opening the panel a
// second time — or two panels at once — reuses the same promise instead of
// racing two identical fetches.
//
// impure — network, once.

import { useEffect, useState } from 'react';
import { getKitForm, getFaceRegistry } from '../../../services/brands.js';

let pending = null;

const load = () => {
  if (!pending) {
    pending = Promise.all([getKitForm(), getFaceRegistry()])
      .then(([form, faces]) => ({
        form,
        // What the CARDS demand, as distinct from what the loader demands.
        // The palette editor badges both, because a role the templates draw is
        // worth seeing even when a save would succeed without it.
        templates: form.templates || { colors: [], type: [], marks: [] },
        families: faces.families || [],
      }))
      // A failed load must not poison every later attempt: drop the memo so
      // reopening the window retries rather than showing the same error for
      // the rest of the session.
      .catch((err) => { pending = null; throw err; });
  }
  return pending;
};

/** @returns {{spec: object|null, error: string|null}} */
export const useKitSpec = () => {
  const [spec, setSpec] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    load()
      .then((value) => { if (live) setSpec(value); })
      .catch((err) => { if (live) setError(err?.message || 'the brand kit form could not be read'); });
    return () => { live = false; };
  }, []);
  return { spec, error };
};
