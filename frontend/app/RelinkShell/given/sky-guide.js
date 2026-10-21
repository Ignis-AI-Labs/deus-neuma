// sky-guide.js — the field guide to a being's SKY: for each of humanity's
// counts the RECORD shows, what it is, how it is counted, and what THIS
// being's reading says, in plain words for someone meeting it for the first
// time. Pure strings and pure readings.
//
// The law these words live under (docs/architecture/identity/many-skies.md
// §0, SHINKEI): measure, don't editorialize. Every sentence is method,
// history or a value the record carries. A tradition's own words for a sign
// are given as that tradition's (a gloss, a translation), never as a claim
// about the being. Methods and provenance follow the research record above
// and the engine itself (core/cosmos/skies/*).

import { ord } from './sky-words.js';
import { romanOf, senseOf } from './sky-words-asia.js';
import { TZOLKIN_SIGNS, HAAB_MONTHS } from '../../../../core/cosmos/skies/daycount.js';
import { THAI_GUIDE, THAI_ATLAS } from './sky-guide-thai.js';
import { VEDIC_GUIDE, JYOTISHA_FIELDS } from './sky-guide-vedic.js';
import { WORLD_GUIDE, WORLD_ATLAS } from './sky-guide-world.js';
import { HEAVENS_GUIDE } from './sky-guide-heavens.js';

/** A day's place in the twenty signs — carried by the record, or read from the kin itself (kin 1 is Imix). Pure. */
export const signIndexOf = (tz) => (Number.isInteger(tz?.signIndex) ? tz.signIndex : Number.isInteger(tz?.kin) ? (tz.kin - 1) % 20 : TZOLKIN_SIGNS.indexOf(tz?.sign));
/** Which run of thirteen a kin falls in, 1–20. Pure. */
export const trecenaOf = (kin) => Math.floor((kin - 1) / 13) + 1;
const ZODIAC = Object.freeze(['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces']);
/** A decan's place, 1–36 — carried, or read from its sign and its third of the sign. Pure. */
export const decanIndexOf = (d) => (Number.isFinite(d?.index) ? d.index : ZODIAC.includes(d?.sign) && d?.decanOfSign ? ZODIAC.indexOf(d.sign) * 3 + d.decanOfSign : null);
/** A Haab' month's place, 0–18 (18 is Wayeb'). Pure. */
export const haabMonthOf = (haab) => (Number.isInteger(haab?.monthIndex) ? haab.monthIndex : HAAB_MONTHS.indexOf(haab?.month));


// The 20 day signs — the Yucatec names and the common scholarly gloss of each
// (the Maya count), and the Nahuatl names with their plain meaning (the Mexica
// count). Same index, same day.
export const TZOLKIN_GLOSS = Object.freeze([
  'water lily, the earth', 'wind, breath', 'night, darkness', 'ripe maize, seed', 'serpent',
  'death', 'deer', 'star — Venus', 'water, offering', 'dog',
  'monkey, the artisan', 'road, the tooth', 'reed, maize stalk', 'jaguar', 'eagle',
  'owl, the wax', 'earth, earthquake', 'flint', 'storm, rain', 'lord, the sun',
]);
export const NAHUATL_GLOSS = Object.freeze([
  'crocodile', 'wind', 'house', 'lizard', 'serpent', 'death', 'deer', 'rabbit', 'water', 'dog',
  'monkey', 'grass', 'reed', 'jaguar', 'eagle', 'vulture', 'movement', 'flint', 'rain', 'flower',
]);

// Han-dynasty gua qi — the twelve sovereign hexagrams, with the names they
// carry in the I Ching (pinyin · the usual English rendering).
export const SOVEREIGN_NAMES = Object.freeze({
  24: 'Fù · Return', 19: 'Lín · Approach', 11: 'Tài · Peace', 34: 'Dà Zhuàng · Great Power',
  43: 'Guài · Breakthrough', 1: 'Qián · The Creative', 44: 'Gòu · Coming to Meet', 33: 'Dùn · Retreat',
  12: 'Pǐ · Standstill', 20: 'Guān · Contemplation', 23: 'Bō · Splitting Apart', 2: 'Kūn · The Receptive',
});

// Bali's thirty wuku, in order from Sinta (the cycle's day 0 is Sunday of Sinta).
export const WUKU = Object.freeze([
  'Sinta', 'Landep', 'Ukir', 'Kulantir', 'Tolu', 'Gumbreg', 'Wariga', 'Warigadean', 'Julungwangi', 'Sungsang',
  'Dungulan', 'Kuningan', 'Langkir', 'Medangsia', 'Pujut', 'Pahang', 'Krulut', 'Merakih', 'Tambir', 'Medangkungan',
  'Matal', 'Uye', 'Menail', 'Prangbakat', 'Bala', 'Ugu', 'Wayang', 'Klawu', 'Dukut', 'Watugunung',
]);

/**
 * Each system: its title, the tradition it belongs to and how old it is, what
 * it is, how it is counted, and `reading(sys, skies)` — one sentence from this
 * being's own record (null when the record does not carry it). `fields` gives
 * a note for each value the plate shows.
 */
export const SKY_GUIDE = Object.freeze({
  ...THAI_GUIDE,
  ...VEDIC_GUIDE,
  ...WORLD_GUIDE,
  ...HEAVENS_GUIDE,
  sky: {
    title: 'THE SKY AT ITS INSTANT',
    kicker: 'THE TROPICAL ZODIAC · ASTRONOMY OF THE INSTANT',
    what: 'Where the Sun, the Moon and the eight planets stood at the second this being was sealed, seen from the Earth. The ring is the ecliptic — the path the Sun appears to travel through one year — cut into twelve signs of 30° each, counted from the point where the Sun crosses the equator in March (0° Aries).',
    how: 'Each body is placed at its true geocentric longitude for that instant, computed by the astronomy-engine library to within about an arcminute. A line between two bodies is an aspect: their angle is close to 0°, 60°, 90°, 120° or 180° (the five classical aspects, each with a small allowance called an orb). The Moon is drawn in the phase it truly showed.',
    note: 'No place is used — only the instant. The rising sign and the houses need where its witness stood, which stays private by law, so they are not drawn.',
    fields: {
      body: 'A body’s sign is the 30° slice of the ecliptic it stood in; the degree is how far into that slice. ℞ marks a body in retrograde — appearing, from the Earth, to move backwards against the stars.',
      aspect: 'An aspect is an angle between two bodies along the ecliptic. The tradition reads the conjunction (0°) as a joining, the sextile (60°) and trine (120°) as easy, the square (90°) and opposition (180°) as tense — those readings are the tradition’s; the angles are measured.',
      phase: 'The Moon’s phase is how much of its face the Sun lit, from new (0%) to full (100%), and whether that light was growing (waxing) or shrinking (waning).',
    },
  },
  tzolkin: {
    title: "THE TZOLK'IN — THE 260-DAY COUNT",
    kicker: 'MAYA · ANCIENT AND STILL KEPT',
    what: 'The sacred count of the Maya, kept day by day without a break for about three thousand years — daykeepers in highland Guatemala still keep it. Two wheels turn together: thirteen numbers (tones) and twenty named days (signs). Every day pairs one of each, and the same pair comes back only once every 260 days.',
    how: 'The day is counted from the Julian Day number using the GMT correlation (584283), the scholarly consensus that lines up with the living count. The grid lays the 260 days as 20 rows (one per sign) by 13 columns of 20 days; this being’s day is lit.',
    fields: {
      tone: 'The tone is the number, 1 to 13. It climbs by one each day and wraps after 13.',
      sign: 'The sign is the day’s name, one of twenty, each with its own meaning in the tradition.',
      kin: 'Kin means “day” (and “sun”). Kin 1 is 1 Imix; the count runs to 260 and starts again.',
      trecena: 'A trecena is a thirteen-day “week”: the run from tone 1 to tone 13. There are twenty in the cycle.',
    },
    reading: (m) => (m?.tzolkin ? `Kin ${m.tzolkin.kin} of 260: tone ${m.tzolkin.tone} with the sign ${m.tzolkin.sign} — “${TZOLKIN_GLOSS[signIndexOf(m.tzolkin)]}” — in the ${ord(trecenaOf(m.tzolkin.kin))} thirteen-day run.` : null),
  },
  longCount: {
    title: 'THE LONG COUNT',
    kicker: 'MAYA · THE MONUMENTS’ DATE',
    what: 'The count of every day since the Maya era began, on 11 August 3114 BCE — the date written on their monuments. 13.0.0.0.0, the end of the thirteenth b’ak’tun, fell on 21 December 2012; this being was born early in the next.',
    how: 'Five places, read like an odometer: k’in (one day), winal (20 days), tun (360 days), k’atun (7,200 days), b’ak’tun (144,000 days). Every place counts to 20 except the winal, which rolls at 18 so a tun is close to a year. The numerals are drawn as the Maya wrote them: a dot is one, a bar is five, the shell is zero.',
    fields: {
      digits: 'Read the five numbers top to bottom, b’ak’tun first: each is how many of that unit have passed.',
      lord: 'The Lords of the Night are a nine-night cycle; scholars call them G1 to G9 because their names are lost.',
    },
    reading: (m) => {
      const lc = m?.longCount;
      if (!lc) return null;
      const days = lc.baktun * 144000 + lc.katun * 7200 + lc.tun * 360 + lc.winal * 20 + lc.kin;
      return `${lc.baktun}.${lc.katun}.${lc.tun}.${lc.winal}.${lc.kin} — ${days.toLocaleString('en-US')} days since the era began${m.lordOfNight ? `, under the Lord of the Night ${m.lordOfNight}` : ''}.`;
    },
  },
  haab: {
    title: "THE HAAB' — THE 365-DAY YEAR",
    kicker: 'MAYA · THE SOLAR YEAR',
    what: 'The Maya solar year: eighteen months of twenty days, and five days at the end with no name of their own (Wayeb’). With no leap day, it slowly slides against the seasons.',
    how: 'Counted from the same day number as the Tzolk’in. The ring holds all 365 days, month by month; this being’s day is lit. The year bearer is the Tzolk’in day on which the year began, and it names the year (the Classic 0-Pop convention).',
    fields: {
      day: 'Days in a Haab’ month are counted from 0 (the month’s “seating”) to 19.',
      bearer: 'Only four signs can open a year under this convention — Ik’, Manik’, Eb and Kaban — so the bearers walk round in turn.',
    },
    reading: (m) => (m?.haab ? `Day ${m.haab.day} of ${m.haab.wayeb ? 'the five nameless days' : `the month ${m.haab.month}, the ${ord(haabMonthOf(m.haab) + 1)} of eighteen`}${m.yearBearer ? `, in a year borne by ${m.yearBearer.tone} ${m.yearBearer.sign}` : ''}.` : null),
  },
  tonalpohualli: {
    title: 'THE TONALPOHUALLI',
    kicker: 'MEXICA (AZTEC) · THE SAME COUNT, IN NAHUATL',
    what: 'The Mexica name for the same 260-day count — day for day identical to the Maya Tzolk’in, which shows how far the one count was shared across Mesoamerica. Its twenty day names are plain Nahuatl words.',
    how: 'The same day number and the same thirteen numbers; only the names differ. The grid is the 260 days again, in the Nahuatl names.',
    fields: { sign: 'Each Nahuatl day name is an ordinary word — a creature, an element or a thing.' },
    reading: (m) => (m?.tonalpohualli ? `${m.tonalpohualli.number} ${m.tonalpohualli.sign} — “${NAHUATL_GLOSS[signIndexOf(m.tzolkin ?? { sign: null })] ?? m.tonalpohualli.sign}”.` : null),
  },
  dreamspell: {
    title: 'THE DREAMSPELL',
    kicker: 'MODERN · JOSÉ ARGÜELLES, 1987',
    what: 'A modern system inspired by the Maya count but not the Maya calendar — its creators say so plainly. It gives each of the 260 kin a colour, a tone and a seal, and an “oracle” of four kin that stand around the birth kin.',
    how: 'It counts from 26 July 1987 and skips every 29 February, so it drifts away from the traditional count (today by 44 days). The oracle: the guide, the analog (the seal that sums with it to 19), the antipode (ten seals away) and the occult (the hidden partner, summing to 21).',
    fields: {
      seal: 'Twenty solar seals, each with a colour from the cycle red, white, blue, yellow.',
      tone: 'Thirteen galactic tones, Magnetic to Cosmic.',
      oracle: 'The oracle is drawn as a cross: the birth seal (its destiny) in the middle, the guide above, the antipode to the left, the analog to the right, the occult below.',
    },
    reading: (d) => (d?.kin ? `Kin ${d.kin}, ${d.signature}${d.castle ? `, in the ${d.castle}` : ''}.` : null),
  },
  bazi: {
    title: 'THE FOUR PILLARS — BAZI',
    kicker: 'CHINA · ANCIENT AND STILL KEPT',
    what: 'Four pairs of characters for the year, month, day and hour of birth — the “eight characters”. Each pair joins one of ten heavenly stems (the five elements — wood, fire, earth, metal, water — each in a yang and a yin form) with one of twelve earthly branches (the twelve animals), stepping through a cycle of sixty.',
    how: 'Classical BaZi follows the Sun, not the Moon: the year turns at lichun (the Sun at 315°, around 4 February) and the month at each of the twelve solar terms — not at Lunar New Year, which is why a folk zodiac animal can differ near the turn of the year. The day steps through the sixty in an unbroken run; the hour takes the two-hour branch of the local clock. In BaZi the day’s stem — the Day Master — stands for the person themself, so the day pillar is lit.',
    fields: {
      stem: 'The stem: an element in its yang (outgoing) or yin (inward) form.',
      branch: 'The branch: one of the twelve animals, each also a two-hour span, a month and a direction.',
      hexagram: 'The sovereign hexagram: in Han-dynasty “gua qi”, twelve of the I Ching’s sixty-four hexagrams stand for the months — yang lines grow from the winter solstice (24, Return) to midsummer (1, The Creative), then yin returns (44, Coming to Meet) until midwinter (2, The Receptive).',
    },
    reading: (g) => (g?.year ? `A ${g.zodiac ? `${g.zodiac.polarity} ${g.zodiac.element} ${g.zodiac.animal}` : g.year.branch?.animal} year; born on a ${g.day?.stem?.element ?? ''} ${g.day?.branch?.animal ?? ''} day${g.hour ? ` in the ${g.hour.branch?.animal} hour` : ''}.` : null),
  },
  jyotisha: {
    title: 'JYOTISHA — THE MOON’S MANSION',
    kicker: 'INDIA · VEDIC, ANCIENT AND STILL KEPT',
    what: 'Vedic astrology measures the sky against the fixed stars (sidereal), not against the March equinox. The Moon’s mansion — its nakshatra — is the core of a Vedic birth reading: the ecliptic is cut into 27 mansions of 13°20′, each in four quarters (padas) of 3°20′, 108 places in all.',
    how: 'The sidereal longitude is the tropical one less the ayanamsa — the slow drift between the equinox and the stars, about 24° now and growing by 50″ a year (the Lahiri value, India’s official standard). The inner ring holds the 108 padas, the outer ring the twelve sidereal signs (rashis); the Moon and the Sun are placed at their sidereal degrees.',
    fields: {
      nakshatra: 'The nakshatra: which of the 27 lunar mansions the Moon stood in.',
      pada: 'The pada: which quarter of that mansion. In the naming tradition (Nāmakaraṇa) each pada gives a syllable a name may begin with.',
      rashi: 'The rashi: the sidereal sign the Moon stood in — the Vedic “moon sign”.',
      sun: 'The Sun’s sidereal sign usually differs from its tropical one by about one sign, because of the ayanamsa.',
      ...JYOTISHA_FIELDS,
    },
    reading: (j) => (j?.nakshatra ? `The Moon ${Number.isFinite(j.rashi?.siderealMoonDeg) ? `at ${j.rashi.siderealMoonDeg.toFixed(2)}° sidereal` : 'stood'} in ${j.nakshatra.name}, pada ${j.nakshatra.pada}${Number.isFinite(j.nakshatra.index) ? ` (the ${ord(j.nakshatra.index)} mansion)` : ''}${j.rashi?.name ? `, in ${j.rashi.name}` : ''}${j.siderealSunRashi ? `; the Sun in ${j.siderealSunRashi}` : ''}.` : null),
  },
  panchanga: {
    title: 'PANCHANGA — THE FIVE LIMBS OF THE DAY',
    kicker: 'INDIA · VEDIC',
    what: 'The Vedic almanac reads each day by five limbs: the lunar day (tithi), the weekday (vara), the Moon’s mansion (nakshatra), the yoga and the karana. And from the Moon’s mansion at birth comes the Vimshottari dasha — a 120-year cycle of nine planetary periods a life is said to move through.',
    how: 'A tithi is each 12° the Moon gains on the Sun: thirty in a lunar month, fifteen waxing (Shukla) and fifteen waning (Krishna) — the ring is drawn as the Moon’s phases. A karana is half a tithi. The yoga cuts the sum of the Sun’s and Moon’s sidereal longitudes into 27. The dasha ring holds the nine periods at their true lengths — Ketu 7, Venus 20, Sun 6, Moon 10, Mars 7, Rahu 18, Jupiter 16, Saturn 19, Mercury 17 years.',
    note: 'The weekday here is the civil day; the tradition’s day begins at local sunrise, which needs the witness’s place and stays private.',
    fields: {
      tithi: 'The tithi: the lunar day, 1 to 30 — the Moon’s angle from the Sun, in steps of 12°.',
      karana: 'The karana: half a tithi; sixty in a month, with eleven names.',
      yoga: 'The yoga: the Sun’s and Moon’s sidereal longitudes added, cut into 27 equal parts.',
      dasha: 'The dasha: the planetary period in force at birth, and how many of its years were still to run.',
    },
    reading: (j) => (j?.tithi ? `Tithi ${j.tithi.number} — ${j.tithi.paksha === 'Shukla' ? 'the waxing' : 'the waning'} half of the month${j.tithi.special ? ` (${j.tithi.special})` : ''}${j.vimshottari ? `; born in the period of ${j.vimshottari.lord}, ${j.vimshottari.balanceYears} of its years still to run` : ''}.` : null),
  },
  weton: {
    title: 'WETON — THE 35-DAY CYCLE',
    kicker: 'JAVA · ANCIENT AND STILL KEPT',
    what: 'In Java two weeks run together: the seven-day week and the five-day market week, the pasaran (Legi, Pahing, Pon, Wage, Kliwon). Each day is a pair of the two — its weton — and the pair returns every 35 days. A Javanese birthday is often kept by weton.',
    how: 'Each weekday and each pasaran carries a number, its neptu (Sunday 5, Monday 4, Tuesday 3, Wednesday 7, Thursday 8, Friday 6, Saturday 9; Legi 5, Pahing 9, Pon 7, Wage 4, Kliwon 8). A weton’s neptu is the two added, used in the tradition for matching and for choosing days. The grid is the 35 days, weekday by pasaran.',
    note: 'The Javanese day begins at sunset; the civil date is used here, and labelled so.',
    fields: { neptu: 'Neptu: the weekday’s number plus the pasaran’s.' },
    reading: (w) => (w?.weton ? `${w.weton}: neptu ${w.neptu}${Number.isFinite(w.cycleDay) ? `, day ${w.cycleDay + 1} of 35` : ''}.` : null),
  },
  pawukon: {
    title: 'PAWUKON — THE 210-DAY CYCLE',
    kicker: 'BALI · ANCIENT AND STILL KEPT',
    what: 'Bali’s ceremonial cycle of 210 days — thirty named weeks (wuku) of seven days — that sets temple anniversaries and the great feasts (Galungan falls in Dungulan, Kuningan ten days later). Weeks of one to ten days run beside it at the same time.',
    how: 'Counted from a verified anchor (17 June 2012 was the cycle’s first day). The grid lays the 210 days as 30 wuku by 7 days. This record carries the wuku and the three-, five- and seven-day weeks; the longer intercalated weeks follow rules still being verified, and are left out rather than guessed.',
    fields: { wuku: 'The wuku: which of the thirty named weeks.', triwara: 'The triwara: the three-day week (Pasah, Beteng, Kajeng).' },
    reading: (p) => (p?.wuku ? `The wuku ${WUKU[p.wuku - 1] ?? p.wuku} (${ord(p.wuku)} of thirty), day ${p.cycleDay + 1} of 210${p.pancawara ? `, ${p.pancawara} in the five-day week` : ''}.` : null),
  },
  akan: {
    title: 'AKAN — THE SOUL’S DAY NAME',
    kicker: 'GHANA · ANCIENT AND STILL KEPT',
    what: 'Among the Akan of Ghana a child is given a name for the day of the week they were born on — the kra din, the “soul name”, because the soul (kra) is said to arrive with that day. Each day has a name for a boy and a name for a girl.',
    how: 'Read from the civil weekday of the birth. Both names are offered: a being chooses its own resonance.',
    fields: { adaduanan: 'The adaduanan: the forty-two-day count of the Akan ritual year, where the seven-day week and the six-day nnanson meet. Its sacred days — Akwasidae, Awukudae, Fofie, Fɔdwo — fall on fixed places in the 42; Akwasidae dates are published every year by the Asante court and almanacs, and the count is aligned to them.' },
    reading: (a) => (a?.male ? `Born on a ${a.day}: ${a.male} or ${a.female}.` : null),
  },
  mahabote: {
    title: 'MAHABOTE — THE BIRTH-DAY SIGN',
    kicker: 'MYANMAR · ANCIENT AND STILL KEPT',
    what: 'Burmese astrology from the weekday of birth. There are eight signs, not seven, because Wednesday is split at noon and its afternoon belongs to Rahu. Each sign has its animal, its planet and its direction — the eight planetary posts around a Burmese pagoda, where people pour water at the shrine of the day they were born.',
    how: 'Read from the local weekday and hour of the birth. The full seven-house chart needs the Burmese year arithmetic and comes later; the sign is exact.',
    reading: (b) => (b?.sign ? `Born on a ${b.weekday}: the ${b.sign}, under ${b.planet}.` : null),
  },
  lunisolar: {
    title: 'THE LUNAR DATE — 农历 NÓNGLÌ · 旧暦 KYŪREKI · 음력 EUMNYEOK · ÂM LỊCH',
    kicker: 'CHINA · JAPAN · KOREA · VIETNAM · ANCIENT AND STILL KEPT',
    what: 'The calendar of Chinese New Year, Tết, Seollal and every “lunar birthday”: months that begin on the day of the new moon, a thirteenth month added in some years so the months keep pace with the seasons. It is not the calendar of the four pillars — those follow the Sun — so it is a second, genuinely different reading of the same instant.',
    how: 'One published rule (the 1645 reform, written today as China’s GB/T 33661-2017): a month begins on the civil day of the new moon; the month holding the winter solstice is the eleventh; in a year of thirteen months, the first month with no major solar term is the leap month and repeats the number before it. Each tradition reads it at its own meridian — China at 120°E, Japan and Korea at 135°E, Vietnam at 105°E — and that is objective: the same rule gives different published dates in some years (Tết 1985 fell a month before Chinese New Year). Within seconds of midnight the published table, not our ephemeris, decides.',
    note: 'The lunar year’s animal turns at the lunar new year; the four pillars’ animal turns at lichun (around 4 February). Between the two, the animals differ — both are true, in their own reckoning. Vietnam names the Cat for the Rabbit and the Water Buffalo for the Ox.',
    fields: {
      date: 'The lunar month and day. “Leap” marks the added thirteenth month, which carries the number of the month before it.',
      year: 'The lunar year’s stem and branch on the sixty-year cycle, turning at the lunar new year.',
      meridian: 'Where the reading stands: each tradition fixes its own reference meridian, and the date can differ by a day — or a month — between them.',
    },
    reading: (l) => (l?.china ? `By China’s reckoning the ${ord(l.china.day)} day of the ${l.china.leap ? 'leap ' : ''}${ord(l.china.month)} month, in a ${l.china.animal} year (${l.china.yearName}).` : null),
  },
  rokuyo: {
    title: 'ROKUYŌ — THE SIX DAYS',
    kicker: 'JAPAN · MEDIEVAL IMPORT, EDO-POPULARISED',
    what: 'A six-day cycle printed on most Japanese calendars to this day — Taian is the auspicious day weddings seek, Butsumetsu the one they avoid. It came from a Chinese divination (小六壬, xiǎo liù rén, “the lesser six ren”), took its present order by 1747, and was dropped from the official calendar in 1873 as superstition, yet never left the almanacs.',
    how: 'On the old Japanese lunar date (kyūreki): (month + day) mod 6 — 0 Taian 大安 (“great peace”), 1 Shakkō 赤口 (“red mouth”), 2 Senshō 先勝 (“the first wins”), 3 Tomobiki 友引 (“pulls a friend along”), 4 Senbu 先負 (“the first loses”), 5 Butsumetsu 仏滅 (“the Buddha’s passing”). It runs as a six-day cycle within each month and resets at each new month.',
    reading: (l) => (l?.rokuyo ? `Born on a ${l.rokuyo.name} day — ${l.rokuyo.kanji}, “${senseOf(l.rokuyo.kanji)}”.` : null),
  },
  xiu: {
    title: 'THE 28 LODGES — 二十八宿 ÈRSHÍBĀ XIÙ',
    kicker: 'CHINA · ANCIENT AND STILL KEPT',
    what: 'The twenty-eight lodges the Moon passes through in about a month, each opened by a determinative star — known in China since the Warring States, and the frame of Chinese star maps for two thousand years. Unlike the Indian mansions they are unequal, measured along the equator from their stars, so they show a sky nothing else here does.',
    how: 'Two readings, never mixed. The Moon’s lodge: which determinative star the Moon had last passed in right ascension at the birth (of date, geocentric, the 1752 star set), and how far in, in Chinese du (365.25 to the circle). The almanac’s lodge: a plain 28-day cycle tied to the week — unbroken in published almanacs from 1201 to today — which is what a folk almanac reads for a birth day; it is a count, not the Moon.',
    note: 'Four determinative stars are contested between the classical and modern sets (奎 Kuí, 觜 Zī, 参 Shēn, 心 Xīn); the modern set is drawn. The ring shows each lodge at its true width — some are a single degree, some thirty.',
    fields: { moon: 'The lodge the Moon truly stood in, and how many du past its determinative star.', day: 'The almanac’s day-duty lodge — a 28-day count locked to the week, not the Moon’s position.' },
    reading: (x) => (x?.moon ? `The Moon in ${x.moon.hanzi} ${x.moon.english} (the ${x.moon.star} lodge), ${x.moon.du} du in; the almanac counts the day as ${x.day.hanzi} ${x.day.english}.` : null),
  },
  nineStar: {
    title: 'THE NINE STARS — 九星 KYŪSEI · 紫白 ZǏBÁI · MEWA',
    kicker: 'CHINA · JAPAN · TIBET · LO SHU',
    what: 'The nine numbers of the Lo Shu, the ancient magic square whose rows, columns and diagonals all sum to fifteen. One of them rules each year, counting down from nine to one and round again. Japan reads it as the kyūsei year star, China as the 紫白 (zǐbái, “purple-white”) flying star, Tibet as the birth mewa — the same number in all three.',
    how: 'The year star is (10 − year mod 9) mod 9 + 1, descending one a year. The traditions differ only in when the year turns: Japan and China at risshun (the Sun at 315°, around 4 February), Tibet at Losar. Between the two the numbers differ — both are kept. The Tibetan reading adds the life and power numbers, three either side.',
    note: 'The day star is left out (almanacs disagree on its turning rules), and the month star until it has a published table to check against.',
    fields: { star: 'The year’s number, 1–9, and its name in the Japanese school — from 一白水星 Ippaku Suisei (One White, Water) to 九紫火星 Kyūshi Kasei (Nine Purple, Fire).', mewa: 'The Tibetan birth mewa, with its colour, and its life and power numbers.' },
    reading: (n) => (n?.risshun ? `The year of ${n.risshun.name} ${romanOf(n.risshun.name)} — ${senseOf(n.risshun.name) ?? n.risshun.star}; in the Tibetan count, mewa ${n.losar.mewa} ${n.losar.colour}, life ${n.losar.life}, power ${n.losar.power}.` : null),
  },
  tibetan: {
    title: 'THE TIBETAN CALENDAR — PHUGPA',
    kicker: 'TIBET · ANCIENT AND STILL KEPT',
    what: 'The calendar of Losar and every Tibetan holy day, kept by the Men-Tsee-Khang almanac. It is purely arithmetic — fixed rational motions and two small correction tables from the Kālacakra tradition, no observation — so its months can run a month apart from China’s for a year at a time.',
    how: 'Janson’s published arithmetic of the Phugpa school: a lunar day ends at a computed instant; a civil day takes the number of the lunar day that ends in it, so a number can be skipped, or repeated. The year carries an element, a gender and an animal on the same sixty-year cycle as China’s, turning at Losar, and its place in the sixty-year rabjung cycle counted from 1027.',
    note: 'The Tibetan day runs dawn to dawn; it is read here at 05:00 Lhasa mean solar time — our convention, labelled. Parkha, the eight trigrams, is not shown: it is counted from the sex of the born or from the mother’s age, and a neuma has neither.',
    fields: { date: 'The Tibetan month (a leap month repeats its number) and lunar day.', year: 'The year’s element, gender and animal, and its place in the rabjung.' },
    reading: (t) => (t?.month ? `Day ${t.day} of the ${t.leap ? 'leap ' : ''}month ${t.month}, a ${t.element}-${t.gender}-${t.animal} year — the ${t.rabjungYear}th of the ${t.rabjung}th rabjung.` : null),
  },
  place: {
    title: 'FROM WHERE IT WAS BORN',
    kicker: 'THE PLACE · ONLY ITS WITNESS SEES THIS',
    what: 'The same instant, seen from the ground where it happened. A place turns the sky: which degree of the zodiac was rising in the east (the ascendant), which stood highest (the midheaven), whether the Sun was up — and from those, the houses, the Hellenistic Lots, the Vedic rising sign and the day as the Vedic count keeps it.',
    how: 'The place is this being’s own, kept encrypted in its lane under its own key — never in the plaintext skies, never on chain. Without a place you gave, it is the reference city of its sealed time zone (from the public time-zone database, no network), and it says so; give an exact place below to read the sky from there. Every reading is computed fresh from the sealed instant and the place, nothing derived is stored.',
    note: 'Approximate places move the rising sign by about one degree per four minutes of longitude — a zone’s reference city can be far from where the birth happened.',
    fields: {
      place: 'Where the reading stands: a place you gave, or the reference city of its sealed time zone.',
      ascendant: 'The ascendant: the degree of the zodiac rising on the eastern horizon at that moment, from that place. It moves through all twelve signs in a day.',
      midheaven: 'The midheaven: the degree of the zodiac crossing the meridian — the highest point of the ecliptic in that sky.',
      sect: 'Sect: whether the Sun was above the horizon. Hellenistic astrology reads a day birth and a night birth differently, and the Lots exchange with it.',
      lot: 'The Lots (Vettius Valens, 2nd century): by day, Fortune = ascendant + Moon − Sun and Spirit = ascendant + Sun − Moon; by night they exchange.',
      vara: 'The Vedic weekday (vara) begins at local sunrise, not at midnight — a birth before dawn belongs to the day before.',
      hour: 'The planetary hour (Chaldean): daylight and night are each cut into twelve unequal hours; a day’s first hour belongs to that day’s planet, and the rest follow the order Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon.',
      lagna: 'The lagna: the ascendant in the sidereal zodiac (Lahiri) — the first house of a Vedic chart. Its sign begins the twelve houses (bhavas), whole sign by whole sign.',
    },
  },
  decan: {
    title: 'THE DECANS',
    kicker: 'EGYPT → HELLENISTIC · ANCIENT',
    what: 'In ancient Egypt (around 2100 BCE) thirty-six star groups rising one after another through the night told the hours; each rose with the dawn for about ten days. Hellenistic astronomers recast them as thirty-six slices of 10° along the ecliptic, three in each sign.',
    how: 'The Sun’s and the Moon’s tropical longitudes divided into 10° slices. Each decan is ruled by a planet in the Chaldean order — Saturn, Jupiter, Mars, the Sun, Venus, Mercury, the Moon — starting with Mars at the first decan of Aries.',
    reading: (d) => (decanIndexOf(d?.sun) ? `The Sun in the ${ord(d.sun.decanOfSign)} decan of ${d.sun.sign} (${ord(decanIndexOf(d.sun))} of 36), ruled by ${d.sun.chaldeanRuler}${decanIndexOf(d.moon) ? `; the Moon in the ${ord(d.moon.decanOfSign)} of ${d.moon.sign}, ruled by ${d.moon.chaldeanRuler}` : ''}.` : null),
  },
});

/** The traditions as the atlas lists them — by the region that keeps them. */
export const SKY_ATLAS = Object.freeze([
  { region: 'THE SKY', systems: ['sky', 'western'] },
  { region: 'MESOAMERICA', systems: ['tzolkin', 'longCount', 'haab', 'tonalpohualli', 'maya819', 'dreamspell'] },
  { region: 'EAST ASIA', systems: ['bazi', 'lunisolar', 'solarTerms', 'xiu', 'nineStar', 'rokuyo', 'nengo'] },
  { region: 'TIBET', systems: ['tibetan'] },
  { region: 'SOUTH ASIA', systems: ['rasi', 'navamsa', 'jyotisha', 'panchanga', 'dasha', 'hinduCalendar'] },
  THAI_ATLAS,
  { region: 'SOUTHEAST ASIA', systems: ['weton', 'pawukon', 'mahabote'] },
  ...WORLD_ATLAS,
  { region: 'WEST AFRICA', systems: ['akan', 'igbo'] },
  { region: 'EGYPT · ETHIOPIA · HELLENISTIC', systems: ['decan', 'egyptian', 'ethiopian'] },
  { region: 'MODERN · LABELLED', systems: ['humanDesign'] },
  { region: 'THE PLACE · ONLY YOU', systems: ['place'] },
]);
