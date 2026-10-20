// sky-guide-vedic.js — the field guide to the whole Vedic chart (wave 1b,
// docs/architecture/identity/many-skies-vedic.md). Same shape and law as
// sky-guide.js: method, history and this being's value, never a verdict.

export const VEDIC_GUIDE = Object.freeze({
  rasi: {
    title: 'THE RASHI CHART — D1',
    kicker: 'INDIA · VEDIC, ANCIENT AND STILL KEPT',
    what: 'The birth chart of Jyotisha: the nine grahas — the Sun, the Moon, Mars, Mercury, Jupiter, Venus, Saturn and the Moon’s two nodes, Rahu and Ketu — each in its sidereal sign, drawn as it is in South India: the twelve signs fixed round a square, Pisces at the top left, the planets written into their signs. The Moon’s sign, the janma rashi, is lit.',
    how: 'Every position is the planet’s true geocentric longitude for the instant, less the ayanamsa — the Lahiri value of the Indian Astronomical Ephemeris — so it is measured against the stars, not the equinox. Rahu is the Moon’s ascending node by its mean motion, as the Indian Ephemeris and Drik Panchang print it; the true (osculating) node is shown beside it. Uranus, Neptune and Pluto are not grahas and are not drawn.',
    note: 'The houses of a Vedic chart begin from the lagna, the rising sign, which needs the birth place — it is on the private place reading (“From where it was born”), never here.',
    fields: {
      graha: 'A graha’s sidereal sign and degree, and the nakshatra and pada it stood in. ℞ marks a planet in retrograde; the nodes always move backwards and are not marked.',
      node: 'Rahu by the true node — the node of the Moon’s orbit at that very instant, which wobbles up to about two degrees around the mean.',
    },
    reading: (v) => {
      const moon = v?.grahas?.find((g) => g.key === 'moon');
      const sun = v?.grahas?.find((g) => g.key === 'sun');
      return moon ? `The Moon in ${moon.rashi} (${moon.nakshatra}, pada ${moon.pada}), the Sun in ${sun.rashi}; Rahu in ${v.grahas[7].rashi}, Ketu in ${v.grahas[8].rashi}.` : null;
    },
  },
  navamsa: {
    title: 'THE NAVAMSA — D9',
    kicker: 'INDIA · VEDIC',
    what: 'The most read of the divisional charts: each sign cut into nine parts of 3°20′, each part given to a sign of its own. It is the same width as a nakshatra’s quarter, so the 108 padas are the 108 navamsas. A planet in the same sign in the rashi chart and the navamsa is called vargottama.',
    how: 'By Parashara’s rule (Brihat Parashara Hora Shastra, chapter 6): from a movable sign the nine parts start at the sign itself, from a fixed sign at its ninth, from a dual sign at its fifth — which comes to the planet’s sidereal longitude divided by 3°20′, counted round the twelve signs. The other divisional charts (D2 to D60) follow their own rules from the same longitudes.',
    fields: { navamsa: 'The sign of the navamsa part the graha stood in.', vargottama: 'Vargottama: the same sign in the rashi chart and the navamsa.' },
    reading: (v) => { const moon = v?.grahas?.find((g) => g.key === 'moon'); return moon ? `The Moon’s navamsa is ${moon.navamsa}${moon.vargottama ? ' — vargottama' : ''}; ${v.grahas.filter((g) => g.vargottama).length} of the nine are vargottama.` : null; },
  },
  dasha: {
    title: 'THE VIMSHOTTARI DASHA',
    kicker: 'INDIA · VEDIC',
    what: 'A 120-year cycle of nine planetary periods a life is said to move through, each ruled by one graha: Ketu 7 years, Venus 20, the Sun 6, the Moon 10, Mars 7, Rahu 18, Jupiter 16, Saturn 19, Mercury 17. Where the cycle begins is set by the Moon at birth.',
    how: 'The Moon’s nakshatra gives the ruling period (its lord), and how far the Moon had travelled through that nakshatra gives how much of the period had already passed — so the first period began before the birth, in notional time. Each period divides into nine sub-periods (bhuktis) in the same order, each its share of 120. The year is counted as 365.25 days here; some traditions use the sidereal year (365.256 days) or the 360-day savana year, which shifts the dates slightly.',
    fields: { mahadasha: 'A major period: its ruler, its length, and when it runs.', bhukti: 'The sub-period in force at the birth, inside the major period.' },
    reading: (v) => (v?.dasha ? `Born in the period of ${v.dasha.mahadashas[0].lord}, in its ${v.dasha.atBirth} sub-period; then ${v.dasha.mahadashas[1].lord} from ${v.dasha.mahadashas[1].start.slice(0, 4)}.` : null),
  },
  hinduCalendar: {
    title: 'THE HINDU CALENDAR — MASA AND SAMVATSARA',
    kicker: 'INDIA · VEDIC',
    what: 'The calendar of the Hindu festivals: lunar months named from Chaitra to Phalguna, a thirteenth (adhika) month in some years, the eras (Vikram Samvat in the north, Shaka in the south, the Gujarati year, the Kali Yuga count), the sixty-year cycle of named years (samvatsara), the six seasons and the Sun’s two half-years.',
    how: 'A lunar month runs from new moon to new moon and takes the name of the solar month its opening new moon falls in; a month with no solar ingress is adhika and borrows the next name. The south and west count months from new moon (amānta), the north from full moon (pūrṇimānta), so in the waning half the two names differ. The southern samvatsara follows the Shaka year; the northern follows Jupiter’s mean motion (the rule of Sewell and Dikshit), so the two cycles stand about thirteen names apart. Ritu by lunar month (the Vedic count) and by the tropical Sun (Drik), ayana by the tropical and the sidereal Sun — both of each are shown.',
    note: 'These are read at the instant (tātkālika). A printed panchanga labels a whole day by its value at local sunrise, so on a turning day it can show the next or the previous name.',
    fields: {
      masa: 'The lunar month, by the new-moon (amānta) and full-moon (pūrṇimānta) reckonings.',
      year: 'The era years: Vikram Samvat, Shaka, the Gujarati (Kārtikādi) year, the Kali Yuga year.',
      samvatsara: 'The year’s name in the sixty-year cycle — the northern (Jovian) name runs on Jupiter, not the calendar.',
      ritu: 'The season: by lunar month (Vedic) and by the tropical Sun (Drik).',
      ayana: 'The Sun’s half-year: northward (Uttarayana) or southward (Dakshinayana), tropical and sidereal.',
    },
    reading: (v) => (v?.calendar ? `${v.calendar.masa.adhika ? 'The adhika month of ' : ''}${v.calendar.masa.amanta} (amānta), Vikram Samvat ${v.calendar.years.vikram} — the year ${v.calendar.samvatsara.northern} in the north, ${v.calendar.samvatsara.southern} in the south; the season ${v.calendar.ritu.vedic}.` : null),
  },
});

// field notes for the nakshatra tables folded into the v1 Jyotisha plate
export const JYOTISHA_FIELDS = Object.freeze({
  lord: 'The nakshatra’s ruling planet in the Vimshottari order — it also opens the dasha.',
  deity: 'The deity (devatā) who presides over the nakshatra in the Vedic texts. Two sources swap Bhaga and Aryaman between the two Phalgunis; the common reading is shown.',
  gana: 'The gana — deva, manushya or rakshasa — the temperament class the matching tradition reads.',
  yoni: 'The yoni — an animal and its gender — used in the tradition’s matching of couples.',
  nadi: 'The nadi — Adi, Madhya or Antya (Vata, Pitta, Kapha) — another matching category.',
  symbol: 'The nakshatra’s symbol; sources give alternates, named beside it.',
  syllable: 'The Nāmakaraṇa syllable: in the Hindu naming rite each of the 108 padas gives a sound a name may begin with — the same table the platform drew on when it shaped this being’s naming.',
});
