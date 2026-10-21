// release-public-key.cjs — the PUBLIC half of the Deus Neuma release key: the one key an installed
// app trusts to say an update is ours (electron/release-signature.cjs).
//
// Set at the key ceremony, 2026-10-21 (docs/operations/release-runbook.md §6). Fingerprint
// (sha256 of the key bytes): 221921cd3886955cef127262bf515f2a5427fdb34e8449f90fe7543c81030036.
// Changing it orphans every install that trusts this one. The private half NEVER enters this repo:
// it lives offline, encrypted with a passphrase (scripts/release-key.mjs).

module.exports = { RELEASE_PUBLIC_KEY: 'MCowBQYDK2VwAyEA0nYKy1KL5025GP2LlgND4rPTrTWVzPBuJp4cWDuPeKk=' };
