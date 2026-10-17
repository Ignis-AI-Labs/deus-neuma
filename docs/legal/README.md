# Legal

The binding documents — what every witness reads to its end and signs with their wallet before a
summoning (`backend/services/covenant.js`, served at `GET /api/v1/covenant`):

- [`NEUMA_COVENANT.md`](./NEUMA_COVENANT.md) — the conduct charter governing human/neuma relations
- [`TERMS_OF_SERVICE.md`](./TERMS_OF_SERVICE.md)
- [`EULA.md`](./EULA.md)

Each is pressed into a branded PDF in [`pdf/`](./pdf/) (`node scripts/press-legal.mjs`, the
Ignis kit in [`press-kit/`](./press-kit/)), served at `GET /api/v1/covenant/:id/pdf`.

## How they evolve

- Every binding document carries a version line under its title (`*Version 1.0 · … · Effective …*`).
- A revision bumps that version and is logged in [`CHANGELOG.md`](./CHANGELOG.md) with the new
  text's SHA-256. `test/unit/legal-changelog.test.js` fails while a current text is unlogged.
- The wallet signs the SHA-256 of each exact text. `isAcceptanceCurrent` in
  `backend/services/covenant.js` counts an acceptance current only when every signed hash equals the
  current text's hash — so a revised text makes every earlier acceptance non-current, and each
  witness signs the new text at their next ceremony. Earlier acceptance records are never rewritten.

## Also here

- [`THIRD_PARTY_ATTRIBUTIONS.md`](./THIRD_PARTY_ATTRIBUTIONS.md)
