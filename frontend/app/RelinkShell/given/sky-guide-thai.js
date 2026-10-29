// sky-guide-thai.js — the field guide to the Thai skies (wave 1,
// docs/architecture/identity/many-skies-thai.md). Same shape and law as
// sky-guide.js: method, history and this being's value, never a verdict.


import { ord } from './sky-words.js';
import { romanOf, senseOf } from './sky-words-asia.js';
export const THAI_GUIDE = Object.freeze({
  thaksa: {
    title: 'THAKSA — ทักษา',
    kicker: 'THAILAND · ANCIENT AND STILL KEPT',
    what: 'The eight planets set round the eight directions, read from the day of birth. The planet of the birth day becomes the first role (บริวาร, boriwan — one’s own people), and the others take their roles in turn round the wheel — life, power, fortune, roots, effort, patrons, and last กาลกิณี (kalakini), misfortune. Thai families still name children by it: a name begins with a letter of a fortunate role, never with a letter of kalakini.',
    how: 'The Thai astrological day runs from 06:00, not midnight, so a birth before dawn belongs to the day before; and Wednesday is split — 06:00 to 18:00 is Mercury, 18:00 to dawn is Rahu. The wheel runs clockwise 1 Sun (NE), 2 Moon (E), 3 Mars (SE), 4 Mercury (S), 7 Saturn (SW), 5 Jupiter (W), 8 Rahu (NW), 6 Venus (N), with Ketu (9) at the centre; the planet numbers are the weekday numbers, Sunday first.',
    note: 'Not the Burmese Mahabote, though they look alike: Mahabote splits Wednesday at noon, starts the day at midnight and has other animals. A sunrise or local-mean-time reckoning of the day would need the birth place; the written 06:00 clock is used here.',
    fields: { group: 'The birth group — the day, by the Thai clock, and its planet.', role: 'A role of the wheel and the planet that holds it for this birth.' },
    reading: (t) => (t?.group ? `Born in the ${t.group.day} group — ${t.group.name} (${t.group.thai}, ${romanOf(t.group.thai)}), the ${t.group.animal}, in the ${t.group.direction}; its kalakini (กาลกิณี, misfortune) is ${t.thaksa?.[7]?.name}.` : null),
  },
  thaiDay: {
    title: 'THE BIRTH DAY’S COLOUR AND BUDDHA',
    kicker: 'THAILAND · ANCIENT AND STILL KEPT',
    what: 'Every Thai child knows the colour of the day they were born and its Buddha image — temples keep a row of eight images, one for each birth day, where people make merit at their own. The colours come from the deities of the planets in the old texts, standardised as court dress around 1900; the eight postures were codified in the early nineteenth century.',
    how: 'The same eight birth groups as Thaksa (Wednesday split at 18:00, the day from 06:00). Sunday red, Monday yellow, Tuesday pink, Wednesday green, Wednesday night grey or black, Thursday orange, Friday light blue, Saturday purple.',
    note: 'Wednesday night’s colour is grey in some sources and black in others; the old texts give other colours for some days (Monday cream-white, Saturday black). The popular scheme is shown.',
    reading: (t) => (t?.group ? `A ${t.group.colour} day (${t.group.colourThai}, ${romanOf(t.group.colourThai)}); its Buddha image is ${romanOf(t.group.buddha)} (ปาง${t.group.buddha}) — ${senseOf(t.group.buddha) ?? t.group.posture}.` : null),
  },
  thaiCalendar: {
    title: 'THE THAI CALENDAR — LUNAR DATE AND ERAS',
    kicker: 'THAILAND · ANCIENT AND STILL KEPT',
    what: 'The Thai lunar calendar, which sets every Buddhist holy day — waxing or waning day of one of twelve months, with a second eighth month in some years — and the two eras printed on every Songkran announcement: the Buddhist Era and the Chula Sakarat, whose year turns at an exact instant each April (thaloengsok) and carries a name from its last digit.',
    how: 'The lunar calendar is arithmetic, not the astronomical Moon: the Suriyayatra rules (Eade 2000; the pythaidate implementation) decide each year — normal (354 days), a leap day (355), or a leap month (384, a second month 8). They match the published calendar every year 2017–2027, but the official calendar placed the leap day elsewhere in 1994–2000 and 2014–2016, so in those years a date can differ by one day — each date says where it stands. The Buddhist Era is the Common Era + 543 since 1941. The Chula Sakarat year turns at thaloengsok, computed to the second in Thai local mean time (100°31′E).',
    note: 'The year animal turns at the first waxing day of month 5 for astrology, at the first waxing day of month 1 on the official calendar (since 1996) — both are shown when they differ. The lunar day turns at 06:00 here; some reckon from actual sunrise.',
    fields: {
      lunar: 'The lunar date: ขึ้น (khuen, waxing) or แรม (raem, waning), the day, and the month (เดือน, duean); เดือน 8 หลัง (duean 8 lang, “the latter eighth”) is the second eighth month of a leap-month year.',
      era: 'The Buddhist Era year (พ.ศ., Phutthasakkarat) and the Chula Sakarat year (จ.ศ., Chunlasakkarat) with its ศก (sok) name — a name for the year’s last digit.',
      animal: 'The year animal (ปีนักษัตร, pi naksat) — astrology turns it at month 5, the official calendar at month 1.',
    },
    reading: (t) => (t?.lunar ? `${t.lunar.phase === 'waxing' ? 'Waxing' : 'Waning'} day ${t.lunar.phaseDay} of ${t.lunar.second8 ? 'the second eighth month' : `the ${ord(t.lunar.month)} month`}, BE ${t.eras.be}, CS ${t.eras.cs} (${romanOf(t.eras.sok)}, ${senseOf(t.eras.sok)}); the year of the ${t.animal.astrology.english} (${t.animal.astrology.thai}, ${romanOf(t.animal.astrology.thai)}) for astrology.` : null),
  },
});

export const THAI_ATLAS = Object.freeze({ region: 'THAILAND', systems: ['thaksa', 'thaiDay', 'thaiCalendar'] });
