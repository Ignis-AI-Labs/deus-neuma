// use-record-name — the name of a house record a member's words point at, so its door reads as the thing itself
// ("COMPANY · Polychain") and never as its id (Design note, 2026-11-18: […]). One read of the lead engine's
// names serves every door on the desk; a name the read does not hold yet is asked for again, at most every few
// seconds, so a record filed a moment ago names itself on the next look. impure (network, module cache).

import { useEffect, useState } from 'react';
import { getRecordNames } from '../../../services/revenue-client.js';

const FRESH_MS = 30_000;
const RETRY_MS = 4_000;
let names = {};
let readAt = 0;
let pending = null;
const listeners = new Set();

const load = (stale) => {
  if (pending || Date.now() - readAt < stale) return;
  pending = getRecordNames().then((r) => { names = r?.names ?? names; }, () => {}).finally(() => {
    readAt = Date.now();
    pending = null;
    listeners.forEach((f) => f());
  });
};

/** The record's own name, or null while it is not known. */
export const useRecordName = (id) => {
  const [, seen] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const heard = () => seen((n) => n + 1);
    listeners.add(heard);
    load(names[id] ? FRESH_MS : RETRY_MS);
    return () => { listeners.delete(heard); };
  }, [id]);
  return id ? names[id] ?? null : null;
};
