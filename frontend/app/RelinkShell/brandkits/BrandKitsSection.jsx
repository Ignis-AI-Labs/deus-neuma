// BrandKitsSection — the operator's brand kits, where they can be worked on.
//
// Design note, 2026-08-31, looking at what this used to be: […]
//
// WHAT WAS ACTUALLY WRONG, in the order it mattered:
//
//  1. TWENTY OF THIRTY-NINE GATED FIELDS HAD NO CONTROL. Positioning, message,
//     voice, claims, legal, asset rules, accessibility and channels — eight
//     whole sections — were reachable only by hand-editing JSON in a textarea
//     at the bottom. The panel presented a brand kit as "colours and fonts"
//     while the gate that blocks every campaign asked for nine sections.
//
//  2. NO NAVIGATION. Five hardcoded sections in one scroll.
//
//  3. THE TYPE UI WAS DISHONEST. Eleven flat rows mixing families, weights and
//     tracking, each with a specimen that applied only `fontFamily` — and took
//     it from the row's own value, so DISPLAY WEIGHT rendered its specimen in a
//     font named "900". The family was free text while the renderer embeds only
//     vendored faces, so a kit could name a font, show it correctly on the
//     operator's own machine, and draw every card in a fallback.
//
// The shell is in BrandKitsShell.jsx; this file is the door, kept small so the
// window descriptor in OutreachApps.jsx has one stable thing to mount.
//
// ⚠️ Split across ../brandkits/ rather than one file: the old panel was at 409
// of the 500-line cap before any of this was added.

import './BrandKits.css';
import { BrandKitsShell } from './BrandKitsShell.jsx';

export const BrandKitsSection = ({ brand = null }) => <BrandKitsShell brand={brand} />;
