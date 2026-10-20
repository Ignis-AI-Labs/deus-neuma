// release-public-key.cjs — the PUBLIC half of the Deus Neuma release key: the one key an installed
// app trusts to say an update is ours (electron/release-signature.cjs).
//
// EMPTY until the key ceremony (docs/operations/release-runbook.md §6). While it is empty, every
// update a build is offered is refused as unverified — nothing downloads. `node
// scripts/release-key.mjs --generate <dir outside this repo>` prints the line that goes here.
// The private half NEVER enters this repo.

module.exports = { RELEASE_PUBLIC_KEY: '' };
