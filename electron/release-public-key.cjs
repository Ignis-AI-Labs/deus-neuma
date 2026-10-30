// release-public-key.cjs — the PUBLIC halves of the Deus Neuma release keys: the keys an installed
// app trusts to say an update is ours (electron/release-signature.cjs).
//
// The release key was set at the key ceremony, 2026-10-21 (docs/operations/release-runbook.md §6).
// Fingerprint (sha256 of the key bytes): 221921cd3886955cef127262bf515f2a5427fdb34e8449f90fe7543c81030036.
// It signs every release (scripts/release-key.mjs --sign signs only with this first key).
// Changing it orphans every install that trusts only this one. The private halves NEVER enter this
// repo: they live offline, encrypted with a passphrase (scripts/release-key.mjs).

module.exports = { RELEASE_PUBLIC_KEY: 'MCowBQYDK2VwAyEA0nYKy1KL5025GP2LlgND4rPTrTWVzPBuJp4cWDuPeKk=' };

// Every key an installed app accepts a signature from, the release key first. The OFFLINE BACKUP
// key's line goes after it, once the maintainer has generated that key (`node
// scripts/release-key.mjs --generate <removable media>` prints the line; runbook §6, […]). An install that carries the backup can still be updated if the release key is lost or
// must be retired: the next build moves the backup into first place and drops the old key, and
// every install that updates to it stops trusting the old one.
module.exports.RELEASE_PUBLIC_KEYS = Object.freeze([
  module.exports.RELEASE_PUBLIC_KEY,
  // the offline backup key's line goes here
]);
