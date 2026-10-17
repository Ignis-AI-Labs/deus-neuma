// embeddable-faces — the closed registry of font faces a card may embed.
//
// Lifted out of brand-tokens.js on 2026-08-31 so the BRAND KITS panel can offer
// these as a PICKER rather than a text box. It was a private const in the disk
// loader; three surfaces now need it (the loader, the public font-registry
// route, and the panel's type role cards), and none of them should have to pull
// in a disk door to ask what faces exist.
//
// Named, never a free path — the renderer must not be a door for reading
// arbitrary files off the rig, and the whole point of embedding is that the
// SAME bytes render the same card anywhere.
//
// EVERY FACE IS CARRIED BY THIS REPOSITORY. There is no system path here, and
// that is the invariant, not a coincidence. A face under /usr/share/fonts is
// whatever THIS machine happens to have installed: a different version, or
// absent, and the card silently draws in a fallback stack — the exact drift
// embedding exists to stop. That is not hypothetical: this repo ships a
// Dockerfile, and a container has no Fedora font packages in it at all.
// Vendored bytes render the same card on the rig, in CI, in the container, and
// on Founder's laptop. All families are SIL OFL 1.1 and the licence travels with
// the bytes (fonts/*-OFL.txt) because that is what the licence asks for.
//
// ⚠️ Adding a face means adding its FILE under fonts/ and its licence, not a
// path to something you happen to have installed — brand-card.test.js fails a
// face whose file does not live under fontsDir().

import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const fontsDir = () => path.join(here, 'fonts');

const face = (name) => path.join(here, 'fonts', name);

export const EMBEDDABLE = Object.freeze({
  // Inter — the VOICE face: body copy, labels, everything that is read as
  // language rather than as a number.
  // ⚠️ Inter Light is the weight the Umbrae look-dev sets prose in (`body {
  // font-weight: 300 }`). Registering 400 as "the voice" drew every card's copy
  // a full step heavier than the running product.
  'inter-light': { family: 'Inter', weight: 300, file: face('Inter-Light.ttf') },
  'inter-regular': { family: 'Inter', weight: 400, file: face('Inter-Regular.ttf') },
  'inter-bold': { family: 'Inter', weight: 700, file: face('Inter-Bold.ttf') },
  'inter-semibold': { family: 'Inter', weight: 600, file: face('Inter-SemiBold.ttf') },
  // JetBrains Mono — the DATA face: figures, hashes, anything that must align
  // in a column. ⚠️ Shipped as .otf, not .ttf — the path and the @font-face
  // format both have to say so, or the face silently fails to load and the card
  // falls back to whatever mono the machine has.
  // ⚠️ ExtraLight is the face the look-dev sets its BIG figures in (.spec-numeral,
  // .stat .v, .tick-num — all `font-weight: 200`). A 92px number at 400 reads as
  // a heading; at 200 it reads as an instrument, which is the whole look.
  // Instanced from the upstream variable font at wght=200, so it is .ttf where
  // the other two JetBrains faces are .otf — the format has to say so per face.
  'mono-extralight': { family: 'JetBrains Mono', weight: 200, file: face('JetBrainsMono-ExtraLight.ttf') },
  // Light sits between the look-dev's 200 and the body 400 — vendored because
  // 200 reads thin at feed size on a phone, which is where these cards are
  // actually seen (Design note, 2026-08-31: […]).
  'mono-light': { family: 'JetBrains Mono', weight: 300, file: face('JetBrainsMono-Light.ttf') },
  'mono-data': { family: 'JetBrains Mono', weight: 400, format: 'otf', file: face('JetBrainsMono-Regular.otf') },
  'mono-bold': { family: 'JetBrains Mono', weight: 700, format: 'otf', file: face('JetBrainsMono-Bold.otf') },
  // Rajdhani — the DISPLAY face: condensed, squared-off, technical. Fedora
  // ships no package for it at all, so a system path could only ever have been
  // a path to nothing.
  'rajdhani-semibold': { family: 'Rajdhani', weight: 600, file: face('Rajdhani-SemiBold.ttf') },
  'rajdhani-bold': { family: 'Rajdhani', weight: 700, file: face('Rajdhani-Bold.ttf') },
  // Noto Sans Condensed Black — the DISPLAY face chosen for the cyberpunk/MGS
  // look-dev (Metidar + Design note, 2026-08-30: condensed like Rajdhani but heavy,
  // squared and angular — the sharp weight Rajdhani's open terminals never had.
  'noto-condensed-black': { family: 'Noto Sans Condensed Black', weight: 900, file: face('NotoSansCondensed-Black.ttf') },
  // Space Grotesk — Umbrae's OWN display face, read from the LINE & CYCLE
  // look-dev the platform actually ships (umbrae/docs/design/umbrae-lookdev.html:
  // `--font-display: 'Space Grotesk'`). The cards had drifted onto Rajdhani and
  // then Noto Condensed Black while the product itself was set in this; a brand
  // kit whose face disagrees with the running product is not a brand kit.
  // ⚠️ .otf like JetBrains Mono — the format must say so or the face silently
  // fails to load and the card falls back to a machine font.
  // ⚠️ Light is the ONLY display weight the look-dev uses — the wordmark and the
  // type spec are both `font-weight: 300` on wide tracking. Bold and Medium are
  // kept because other brands ask for them, but a kit claiming to be the
  // look-dev sets its headlines in this one. Instanced from the upstream
  // variable font at wght=300, hence .ttf where Medium and Bold are .otf.
  'grotesk-light': { family: 'Space Grotesk', weight: 300, file: face('SpaceGrotesk-Light.ttf') },
  'grotesk-medium': { family: 'Space Grotesk', weight: 500, format: 'otf', file: face('SpaceGrotesk-Medium.otf') },
  'grotesk-bold': { family: 'Space Grotesk', weight: 700, format: 'otf', file: face('SpaceGrotesk-Bold.otf') },
});

/**
 * The fallback tail a family carries when a kit writes it into a CSS stack.
 * Pure.
 *
 * A kit stores a STACK, not a family — `[…]`
 * — because the browser rendering a preview may not have the vendored bytes yet
 * and the card renderer's own fallback has to be sane. The tail is chosen by
 * what the family IS: a mono face falls back to mono, or a column of figures
 * stops aligning the moment the face is missing.
 */
export const FALLBACK_TAIL = Object.freeze({
  Inter: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  'JetBrains Mono': "ui-monospace, SFMono-Regular, Menlo, monospace",
  Rajdhani: "Inter, system-ui, sans-serif",
  'Noto Sans Condensed Black': "'Arial Narrow', Inter, system-ui, sans-serif",
  'Space Grotesk': "system-ui, -apple-system, sans-serif",
});

/** The default tail for a family nobody vendored. Pure. */
export const DEFAULT_TAIL = 'system-ui, -apple-system, sans-serif';
