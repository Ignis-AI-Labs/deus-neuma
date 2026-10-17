/**
 * MANY SKIES — longitude binnings over the tropical chart.
 *
 * v1: the 36 decans (ancient Egyptian star-clocks, repackaged into 10°
 * ecliptic segments in the Hellenistic era — labeled as such) with Chaldean
 * rulers, for the Sun and Moon.
 *
 * Deliberately omitted in v1, said out loud: the 64 hexagram-gate wheel (its
 * fixed non-King-Wen order needs table verification before we compute it),
 * Sabian degree texts (we author our own 360 — ratified decision 5), and the
 * Hellenistic Lots (need the witness location + day/night sect → the
 * encrypted natal path, not plaintext skies).
 */

import * as Astronomy from 'astronomy-engine';
import { eclipticLongitude, SIGNS } from '../natal-chart.js';

// Chaldean order; the wheel opens at Aries I = Mars → ruler = order[(2 + i) % 7].
const CHALDEAN = Object.freeze(['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon']);

const decanOf = (longitude) => {
  const index = Math.floor(longitude / 10) % 36;
  return {
    index: index + 1, // 1..36
    sign: SIGNS[Math.floor(index / 3)],
    decanOfSign: (index % 3) + 1, // I / II / III
    chaldeanRuler: CHALDEAN[(2 + index) % 7],
  };
};

export const decans = (instant) => ({
  provenance: {
    kind: 'ancient-transformed',
    note: 'Egyptian decan star-clocks (c. 2100 BCE) repackaged as 10° ecliptic segments in the Hellenistic era; Chaldean rulers',
  },
  sun: decanOf(eclipticLongitude(Astronomy.Body.Sun, instant)),
  moon: decanOf(eclipticLongitude(Astronomy.Body.Moon, instant)),
});
