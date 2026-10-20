// sky-guide-heavens.js — the field guide to the skies read from the bodies’
// longitudes (wave 3, docs/architecture/identity/many-skies-world.md): the
// Arabic mansions, the solar terms, the western additions, the 64 gates.
// Same shape and law as sky-guide.js: method, history and this being's value,
// never a verdict.

export const HEAVENS_GUIDE = Object.freeze({
  western: {
    title: 'THE MOON — PHASE, SYZYGY, NODES, LILITH',
    kicker: 'ASTRONOMY · WESTERN ASTROLOGY, ANCIENT AND MODERN',
    what: 'Four readings of the Moon beside the wheel. Its phase at birth, in eight families. The prenatal syzygy — the last new or full moon before the birth, which Ptolemy (Tetrabiblos III.2) used to settle an uncertain birth time. Its nodes, where its path crosses the Sun’s and where eclipses happen. And Black Moon Lilith, the point where the Moon is farthest from Earth, read in modern astrology since the twentieth century.',
    how: 'The phase is the Moon’s angle ahead of the Sun cut into eighths of 45° — new, crescent, first quarter, gibbous, full, disseminating, last quarter, balsamic — the names Dane Rudhyar gave them (1967); where one family ends and the next begins is a convention. The nodes and Lilith are mean positions (Meeus, Astronomical Algorithms, ch. 47); the nodes travel backwards round the zodiac in 18.6 years. Each body also carries its Sabian degree — its degree within its sign counted from one, 1 to 360 round the circle.',
    note: 'The Sabian degrees were given 360 images by Marc Edmund Jones and Elsie Wheeler in 1925. Only the degree number is shown here; the platform will write its own words for the degrees rather than use theirs.',
    fields: {
      phase: 'The Moon’s phase family, and how far ahead of the Sun it stood.',
      syzygy: 'The last new or full moon before the birth: which it was, where it fell, and when.',
      node: 'The Moon’s mean node — the north node where its path rises across the ecliptic, the south node opposite.',
      lilith: 'Black Moon Lilith: the mean apogee of the Moon’s orbit, its farthest point from Earth.',
      sabian: 'The Sabian degree: the degree within the sign rounded up, so 0°01′ of Aries is Aries 1 and 29°59′ is Aries 30.',
    },
    reading: (w) => (w?.phase ? `A ${w.phase.name.toLowerCase()} Moon, ${w.phase.elongation}° ahead of the Sun; born after a ${w.syzygy?.kind} in ${w.syzygy?.sign}; the north node in ${w.meanNode?.sign}, Lilith in ${w.lilith?.sign}.` : null),
  },
  manazil: {
    title: 'THE ARABIC LUNAR MANSIONS — MANĀZIL',
    kicker: 'ARABIA · ANCIENT, RECAST BY ASTROLOGERS',
    what: 'The twenty-eight stations of the Moon (manāzil al-qamar), one for each night of its round. Before Islam the Arabs read the seasons and the rains from the stars that rose and set at dawn through them (the anwāʾ). Astrologers writing in Arabic — al-Bīrūnī, the Picatrix — recast them as twenty-eight equal parts of the zodiac and used them to choose the times of undertakings.',
    how: 'Equal parts of 12°51′26″ from 0° of Aries in the tropical zodiac, as the Picatrix and al-Bīrūnī give them: 360° ÷ 28. Twenty-eight mansions, not the twenty-seven Indian nakshatras, and their own stars, though both count the Moon’s days.',
    fields: { mansion: 'The mansion the Moon stood in, and how far into it.' },
    reading: (m) => (m?.index ? `The Moon in the ${m.index}${m.index === 1 ? 'st' : m.index === 2 ? 'nd' : m.index === 3 ? 'rd' : 'th'} mansion, ${m.name}, ${m.into}° in.` : null),
  },
  solarTerms: {
    title: 'THE 24 SOLAR TERMS — 節氣 JIÉQÌ',
    kicker: 'CHINA · EAST ASIA · ANCIENT AND STILL KEPT',
    what: 'The farmer’s year of China: twenty-four terms by the Sun, each named for what the season does — the Start of Spring, Grain Rain, White Dew, Frost Descent. They set planting and harvest for more than two thousand years and still mark the year across East Asia; UNESCO inscribed them in 2016. Each term holds three pentads of about five days, seventy-two in the year, each with its sign in nature.',
    how: 'Each term begins when the apparent Sun reaches a multiple of 15° — the rule since 1645 (定氣, dìngqì, “fixed qi”); before that the year was cut into equal days. The pentads are 5° each, counted from the Start of Spring (立春, lìchūn, 315°), which also opens the year of the Four Pillars.',
    note: 'The names of the seventy-two pentads are not shown until they are checked against a source.',
    fields: { term: 'The solar term the Sun stood in at birth.', pentad: 'The pentad: its number in the seventy-two, and in its term.' },
    reading: (t) => (t?.hanzi ? `Born in ${t.hanzi}, ${t.english}, in its ${['first', 'second', 'third'][t.pentadInTerm - 1]} pentad (${t.pentad} of 72).` : null),
  },
  humanDesign: {
    title: 'THE 64 GATES',
    kicker: 'MODERN · HUMAN DESIGN, 1987',
    what: 'A modern system, begun in 1987 by Alan Robert Krakower (Ra Uru Hu), that lays the sixty-four hexagrams of the I Ching round the zodiac as “gates”. It reads two moments: the birth itself, and the “design”, when the Sun stood 88° earlier on its path — about three months before. The profile is the pair of lines of the two Suns; the cross, their four gates with the Earth’s.',
    how: 'The gates follow the system’s own order round the circle, beginning with gate 41 at 2° of Aquarius, each 5°37′30″ wide and cut into six lines. Each body’s gate and line is read from its true tropical longitude; the design moment is found by solving for the Sun 88° back; the nodes are the true nodes.',
    note: 'The system’s type, authority, channels and centres are its interpretation and are not computed. The words for the gates are the platform’s own.',
    fields: {
      personality: 'A body’s gate and line at the birth (gate.line).',
      design: 'A body’s gate and line at the design moment, 88° of the Sun before the birth.',
      profile: 'The profile: the line of the birth Sun over the line of the design Sun.',
      cross: 'The cross: the gates of the birth Sun and Earth and the design Sun and Earth.',
    },
    reading: (h) => (h?.personality ? `The Sun in gate ${h.personality.sun.gate}, line ${h.personality.sun.line}; the design Sun in gate ${h.design.sun.gate}; profile ${h.profile}.` : null),
  },
});
