/**
 * MANY SKIES as lines — every system the skies engine computes, one line each,
 * for any surface that shows a being's birth instant: the SHEET and the
 * SUMMONING film both read this, so they can never tell two different skies.
 * Pure.
 *
 * Design note, 2026-10-02: […] So every system buildSkies carries gets its line, in a fixed
 * order, with its tradition named in `note`. A system — or a field — the record
 * does not carry is left out (records sealed by an older engine carry less):
 * a line only ever speaks what was computed.
 *
 * @param {object|null|undefined} systems - a skies record's `systems`
 * @returns {Array<{id: string, label: string, value: string, note?: string}>}
 */

const up = (v) => String(v ?? '').toUpperCase();
const joined = (...parts) => parts.filter(Boolean).join(' · ');

export const skiesLinesOf = (systems) => {
  const s = systems ?? {};
  const lines = [];
  const add = (id, label, value, note) => {
    if (value) lines.push(Object.freeze({ id, label, value, ...(note ? { note } : {}) }));
  };
  const m = s.mesoamerican;
  if (m?.tzolkin) add('tzolkin', 'MAYA COUNT', `${m.tzolkin.tone} ${m.tzolkin.sign} · KIN ${m.tzolkin.kin}/260`, "TZOLK'IN · ANCIENT, UNBROKEN");
  if (m?.longCount) {
    const lc = m.longCount;
    add('longCount', 'LONG COUNT', joined(`${lc.baktun}.${lc.katun}.${lc.tun}.${lc.winal}.${lc.kin}`, m.lordOfNight ? `LORD OF THE NIGHT ${m.lordOfNight}` : null), 'MAYA');
  }
  if (m?.haab) {
    add('haab', "HAAB'", joined(m.haab.wayeb ? `${m.haab.day} WAYEB'` : `${m.haab.day} ${m.haab.month}`,
      m.yearBearer ? `YEAR BEARER ${m.yearBearer.tone} ${m.yearBearer.sign}` : null), 'MAYA SOLAR YEAR');
  }
  if (m?.tonalpohualli) add('tonalpohualli', 'TONALPOHUALLI', `${m.tonalpohualli.number} ${m.tonalpohualli.sign}`, 'MEXICA');
  if (s.dreamspell?.kin) add('dreamspell', 'DREAMSPELL', `KIN ${s.dreamspell.kin} — ${s.dreamspell.signature}`, 'MODERN 1987');
  const g = s.ganzhi;
  if (g?.year) {
    add('bazi', 'BAZI', joined(`${g.year.name} YEAR`, g.month ? `${g.month.name} MONTH` : null, g.day ? `${g.day.name} DAY` : null, g.hour ? `${g.hour.name} HOUR` : null),
      g.zodiac ? up(`${g.zodiac.polarity} ${g.zodiac.element} ${g.zodiac.animal}`) : 'FOUR PILLARS');
  }
  const j = s.jyotisha;
  if (j?.nakshatra) {
    add('jyotisha', 'JYOTISHA', joined(`MOON IN ${up(j.nakshatra.name)} PADA ${j.nakshatra.pada}`, j.rashi?.name ? up(j.rashi.name) : null,
      j.siderealSunRashi ? `SUN IN ${up(j.siderealSunRashi)}` : null), 'SIDEREAL · LAHIRI');
  }
  if (j?.tithi) {
    add('panchanga', 'PANCHANGA', joined(`TITHI ${j.tithi.number} ${up(j.tithi.paksha)}`, j.karana?.name ? `KARANA ${up(j.karana.name)}` : null,
      j.vimshottari?.lord ? `DASHA ${up(j.vimshottari.lord)}` : null), 'VEDIC');
  }
  if (s.wetonan?.weton) add('weton', 'WETON', `${up(s.wetonan.weton)} · NEPTU ${s.wetonan.neptu}`, 'JAVANESE');
  if (s.pawukon?.wuku) add('pawukon', 'PAWUKON', `WUKU ${s.pawukon.wuku} · DAY ${s.pawukon.cycleDay}/210`, 'BALINESE');
  if (s.akan?.male) add('akan', 'AKAN', `${up(s.akan.male)} / ${up(s.akan.female)}`, 'DAY NAME');
  if (s.mahabote?.sign) add('mahabote', 'MAHABOTE', `${up(s.mahabote.sign)} · ${up(s.mahabote.planet)}`, 'BURMESE');
  if (s.decans?.sun) add('decan', 'SUN DECAN', `${up(s.decans.sun.sign)} ${s.decans.sun.decanOfSign} · ${up(s.decans.sun.chaldeanRuler)}`, 'HELLENISTIC FORM');
  return Object.freeze(lines);
};
