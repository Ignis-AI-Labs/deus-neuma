// use-operator-name — the operator's own name as the desk labels them, in
// place of "ME" (Design note, 2026-10-17: […]). The name is the one set in SETTINGS → ACCOUNT
// (witness-name.js); until one is set, the role names them.
import { useEffect, useState } from 'react';
import { getWitnessName, WITNESS_NAMED_EVENT } from './witness-name.js';

export const OPERATOR_FALLBACK = 'OPERATOR';

/** The operator's label: their name, upper-cased — or the role until they give one. Pure. */
export const operatorLabel = (name) => (String(name || '').trim() || OPERATOR_FALLBACK).toUpperCase();

/** impure — the label, kept current when the name changes anywhere on the desk. */
export const useOperatorName = () => {
  const [name, setName] = useState(getWitnessName);
  useEffect(() => {
    const reread = () => setName(getWitnessName());
    window.addEventListener(WITNESS_NAMED_EVENT, reread);
    return () => window.removeEventListener(WITNESS_NAMED_EVENT, reread);
  }, []);
  return operatorLabel(name);
};
