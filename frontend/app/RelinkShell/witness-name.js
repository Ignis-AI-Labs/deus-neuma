// witness-name — the operator's own name on this platform. Set in the
// ACCOUNT section of SETTINGS (the canonical editor), spoken in the
// founding rite's NAMES movement (which loads it from here), and used
// wherever the platform addresses the operator — the HOUSE window's header
// first, every future surface through this one module. Wallet-namespaced
// like the roster cache. The name is a PLATFORM address, not chain data:
// the founding record holds titles; the name is how we speak to each other.
//
// impure (localStorage + a change event) — per-desk for now; a synced
// operator profile is the follow-on, and every consumer already reads
// through here.

// Fired on every change so open surfaces (HOUSE header, an open rite)
// re-read without a reload.
export const WITNESS_NAMED_EVENT = 'operator:named';

const key = () => {
  const wallet = (localStorage.getItem('walletAddress') || '').toLowerCase();
  return wallet ? `${wallet}:witness-name` : 'witness-name';
};

/** The operator's chosen name, or '' when they have not spoken it yet. */
export const getWitnessName = () => {
  try { return localStorage.getItem(key()) || ''; } catch { return ''; }
};

/** Remember the operator's name (trimmed; an empty name clears it). */
export const setWitnessName = (name) => {
  try {
    const clean = (name || '').trim();
    if (clean) localStorage.setItem(key(), clean);
    else localStorage.removeItem(key());
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(WITNESS_NAMED_EVENT, { detail: { name: clean } }));
    }
  } catch { /* a private-mode browser keeps no name — the rite still walks */ }
};
