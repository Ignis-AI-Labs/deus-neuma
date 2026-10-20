/**
 * MANY SKIES wave 3 — the world's calendars and the longitude-read skies,
 * joined into record blocks with their provenance
 * (docs/architecture/identity/many-skies-world.md). The calendars read the
 * being's civil day (the sealed offset's local date); the reference places
 * inside some rules (Mecca, 52.5°E, Tehran, Paris, Tokyo) belong to the
 * calendar, never to the being. Pure.
 */
import { hebrewOf, tabularHijriOf, ummAlQuraOf, HIJRI_MONTHS, ethiopianOf, egyptianOf, zoroastrianOf, igboOf } from './world-days.js';
import { persianOf, bahaiOf, frenchOf, icelandicOf, maya819Of, nengoOf } from './world-years.js';
import { worldSky } from './world-sky.js';

const JST = 540;
const hijri = (d) => ({ ...d, name: HIJRI_MONTHS[d.month - 1] });

/** The wave-3 blocks of one birth: the instant, its civil day (JDN) and local date. Pure. */
export const worldSkies = (instant, jdn, local) => {
  const jst = new Date(instant.getTime() + JST * 60000);
  return {
    hebrew: { provenance: { kind: 'ancient-living', note: 'the fixed calendar (Hillel II, 4th c.): molad and the four postponements, after Reingold & Dershowitz; the day begins at nightfall — the civil date is read' }, ...hebrewOf(jdn) },
    hijri: { provenance: { kind: 'ancient-living', note: 'Umm al-Qura, the Saudi civil calendar (its post-1423 AH rule at Mecca), with the tabular count beside it; a month begun by sighting the crescent can differ by a day and is not computed; the day begins at sunset — the civil date is read' }, ...hijri(ummAlQuraOf(jdn)), tabular: hijri(tabularHijriOf(jdn)) },
    ethiopian: { provenance: { kind: 'ancient-living', note: 'the Alexandrian year of thirteen months, Ethiopian era (Amete Mihret); the Coptic date shares the month and day' }, ...ethiopianOf(jdn) },
    egyptian: { provenance: { kind: 'ancient-transformed', note: 'the civil year of 365 days that wandered through the seasons, counted in the era of Nabonassar (Ptolemy\'s Almagest), proleptic' }, ...egyptianOf(jdn) },
    zoroastrian: { provenance: { kind: 'ancient-living', note: 'the 365-day year of thirty named days; Shahanshahi (the Parsi majority), Kadmi a month earlier, Fasli fixed to 21 March — all three shown' }, ...zoroastrianOf(jdn, local) },
    igbo: { provenance: { kind: 'ancient-living', note: 'the four-day market week (izu), aligned to published Nkwọ dates' }, day: igboOf(jdn) },
    persian: { provenance: { kind: 'ancient-transformed', note: 'the Solar Hijri (Jalali) year of Iran and Afghanistan, opening on the day the March equinox falls before noon at 52.5°E (the statutory rule)' }, ...persianOf(jdn, local.year) },
    bahai: { provenance: { kind: 'modern', year: 1844, note: 'the Badíʿ calendar: Naw-Rúz the day the equinox falls before sunset in Tehran (the rule since 2015), nineteen months of nineteen days and Ayyám-i-Há' }, ...bahaiOf(jdn, local.year) },
    french: { provenance: { kind: 'modern', year: 1793, note: 'the French Republican year from the autumn equinox at Paris (the legal rule), proleptic beyond 1805; the 366 day names are not shown yet' }, ...frenchOf(jdn, local.year) },
    icelandic: { provenance: { kind: 'ancient-living', note: 'the Old Icelandic year of two seasons, opening on the Thursday 19–25 April; the summer week by the modern rule' }, ...icelandicOf(jdn, local.year) },
    maya819: { provenance: { kind: 'ancient-transformed', note: 'the Classic Maya 819-day count: its station, direction and colour (Berlin & Kelley 1961; GMT correlation 584283, as the Long Count)' }, ...maya819Of(jdn) },
    nengo: { provenance: { kind: 'ancient-living', note: 'the Japanese era name, one per reign since 1868 (Era Name Act 1979); read at the Tokyo date' }, ...(nengoOf(jst.getUTCFullYear(), jst.getUTCMonth() + 1, jst.getUTCDate()) ?? { era: null }) },
    ...worldSky(instant),
  };
};
