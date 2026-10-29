// sky-plates-asia.js — the East Asian and Tibetan skies as their instruments
// (wave 2, docs/work/many-skies-complete.md): the lunar date at four
// meridians, rokuyō, the 28 lodges at their true widths, the nine stars on the
// Lo Shu square, the Tibetan year on its sixty. Pure — every value from the
// record (or from the record's own instant by today's engine, sky-plates.js).

import { mansionStartsAt, MANSIONS } from '../../../../core/cosmos/skies/xiu.js';
import { romanOf, senseOf, glossed, thaiLunarWords } from './sky-words-asia.js';

const ROKUYO_KANJI = Object.freeze(['大安', '赤口', '先勝', '友引', '先負', '仏滅']);
const up = (s) => String(s).toUpperCase();
const lunarText = (r) => `${r.leap ? 'LEAP ' : ''}${r.month} / ${r.day}`;

/**
 * Add the East Asian plates to a plate map. Pure.
 * @param {object} s the systems (record, completed)
 * @param {object} rec the skies record
 * @param {{put: Function, cell: Function, cells: Function}} k the plate-building kit (sky-plates.js)
 */
export const addEastAsiaPlates = (s, rec, { put, cell, cells }) => {
  const l = s.lunisolar;
  if (l?.china) {
    const vn = (a) => ({ Rabbit: 'Cat (Mèo)', Ox: 'Water Buffalo (Trâu)' }[a] ?? a);
    put('lunisolar', { kind: 'lunar-month', day: l.china.day, big: lunarText(l.china), small: `${l.china.animal.toUpperCase()} YEAR`, caption: 'A LUNAR MONTH · FROM ONE NEW MOON TO THE NEXT' }, cells(
      cell('CHINA', lunarText(l.china), 'date', `${l.china.yearName.toUpperCase()} · ${l.china.animal.toUpperCase()} · ${l.china.meridian}`),
      cell('JAPAN (KYŪREKI)', lunarText(l.japan), 'meridian', l.japan.meridian),
      cell('KOREA', lunarText(l.korea), 'meridian', l.korea.meridian),
      cell('VIETNAM', lunarText(l.vietnam), 'meridian', `${vn(l.vietnam.animal).toUpperCase()} · ${l.vietnam.meridian}`),
      s.ganzhi?.zodiac && s.ganzhi.zodiac.animal !== l.china.animal
        ? cell('THE TWO ANIMALS', `${l.china.animal} (lunar) · ${s.ganzhi.zodiac.animal} (pillars)`, 'year', 'BORN BETWEEN LICHUN AND THE LUNAR NEW YEAR')
        : null,
    ), l);
    if (l.rokuyo) {
      const at = ROKUYO_KANJI.indexOf(l.rokuyo.kanji);
      put('rokuyo', { kind: 'cycle', count: 6, labels: ROKUYO_KANJI.map((k) => up(romanOf(k))), lit: at, big: l.rokuyo.kanji, small: `${up(l.rokuyo.name)} · ${up(senseOf(l.rokuyo.kanji) ?? '')}`, caption: '6 DAYS · (MONTH + DAY) MOD 6 ON THE JAPANESE LUNAR DATE' }, cells(
        cell('ROKUYŌ', glossed(l.rokuyo.kanji), null),
        cell('ON', lunarText(l.japan), null, 'THE OLD JAPANESE LUNAR DATE'),
      ), l);
    }
  }
  const x = s.xiu;
  if (x?.moon) {
    const date = new Date(rec.instant);
    put('xiu', { kind: 'lodges', starts: mansionStartsAt(date), names: MANSIONS.map((m) => m.hanzi), moonIndex: x.moon.index, moonRa: x.moon.moonRa, dayIndex: x.day?.index ?? null, caption: '28 LODGES · TRUE WIDTHS IN RIGHT ASCENSION, OF DATE' }, cells(
      cell('THE MOON’S LODGE', `${x.moon.hanzi} ${x.moon.english}`, 'moon', `${x.moon.du} OF ${x.moon.widthDu} DU · ${x.moon.star}`),
      x.day ? cell('THE ALMANAC’S LODGE', `${x.day.hanzi} ${x.day.english}`, 'day', 'THE DAY-DUTY COUNT — NOT THE MOON') : null,
    ), x);
  }
  const n = s.nineStar;
  if (n?.risshun) {
    put('nineStar', { kind: 'loshu', star: n.risshun.star, mewa: n.losar?.mewa ?? null, caption: 'THE LO SHU · EVERY LINE SUMS TO 15' }, cells(
      cell('YEAR STAR', `${n.risshun.star} · ${glossed(n.risshun.name)}`, 'star', `KYŪSEI, THE NINE STARS (紫白 ZǏBÁI, “PURPLE-WHITE”) — FROM RISSHUN ${n.risshun.year}`),
      n.losar ? cell('MEWA', `${n.losar.mewa} · ${n.losar.colour}`, 'mewa', `TIBETAN — FROM LOSAR ${n.losar.year} · LIFE ${n.losar.life} · POWER ${n.losar.power}`) : null,
    ), n);
  }
  const th = s.thai;
  if (th?.group) {
    const wheel = th.thaksa.map((r) => ({ sign: r.name, planet: r.thai, day: r.role, dir: r.direction, deg: { NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315, N: 0 }[r.direction] }));
    put('thaksa', { kind: 'compass', posts: wheel, lit: 0, caption: '8 PLANETS · 8 DIRECTIONS · KETU AT THE CENTRE' }, cells(
      ...th.thaksa.map((r) => cell(`${r.role} ${up(romanOf(r.role))} · ${up(r.roleEnglish)}`, `${r.planet} ${r.name}`, 'role', `${r.thai} ${up(romanOf(r.thai))} · ${r.direction}`)),
    ), th);
    put('thaiDay', { kind: 'cycle', count: 8, labels: ['SUN', 'MON', 'TUE', 'WED', 'WED N', 'THU', 'FRI', 'SAT'], lit: [1, 2, 3, 4, 8, 5, 6, 7].indexOf(th.group.planet), big: up(th.group.colour), small: up(romanOf(th.group.buddha)), caption: '8 BIRTH DAYS · WEDNESDAY SPLIT AT 18:00' }, cells(
      cell('BIRTH DAY', th.group.day, null, 'THE THAI DAY RUNS FROM 06:00'),
      cell('COLOUR', `${th.group.colour} — ${th.group.colourThai} ${romanOf(th.group.colourThai)}`, null),
      cell('BUDDHA IMAGE', `${romanOf(th.group.buddha)} — ${senseOf(th.group.buddha) ?? th.group.posture}`, null, `ปาง${th.group.buddha}`),
    ), th);
    const lunar = `${th.lunar.phase === 'waxing' ? 'ขึ้น' : 'แรม'} ${th.lunar.phaseDay} ค่ำ เดือน ${th.lunar.second8 ? '๘๘ (8 หลัง)' : th.lunar.month}`;
    const words = thaiLunarWords(th.lunar);
    const animal = (a) => `the ${a.english} — ${a.thai} ${romanOf(a.thai)}`;
    put('thaiCalendar', { kind: 'lunar-month', day: th.lunar.phase === 'waxing' ? th.lunar.phaseDay : th.lunar.phaseDay + 15, big: `${th.lunar.phase === 'waxing' ? 'WAXING' : 'WANING'} ${th.lunar.phaseDay}`, small: `MONTH ${th.lunar.second8 ? '8 (THE SECOND)' : th.lunar.month}`, caption: 'THE THAI LUNAR MONTH · ขึ้น KHUEN (WAXING) THEN แรม RAEM (WANING)' }, cells(
      cell('LUNAR DATE', words[0].toUpperCase() + words.slice(1), 'lunar', `${lunar} · ${up(th.lunar.yearType)} YEAR · ${up(th.lunar.standing)}`),
      cell('BUDDHIST ERA', `BE ${th.eras.be}`, 'era', 'พ.ศ. PHUTTHASAKKARAT'),
      cell('CHULA SAKARAT', `CS ${th.eras.cs} — ${romanOf(th.eras.sok)}, ${senseOf(th.eras.sok) ?? ''}`, 'era', `จ.ศ. ${th.eras.cs} ${th.eras.sok} · TURNS AT THALOENGSOK`),
      cell('YEAR ANIMAL', animal(th.animal.astrology), 'animal', th.animal.official.thai !== th.animal.astrology.thai ? `ASTROLOGY · OFFICIAL CALENDAR: ${up(animal(th.animal.official))}` : 'ASTROLOGY AND OFFICIAL CALENDAR AGREE'),
    ), th);
  }
  const t = s.tibetan;
  if (t?.month) {
    put('tibetan', { kind: 'cycle', count: 60, lit: t.rabjungYear - 1, big: `${t.element.toUpperCase()} ${t.animal.toUpperCase()}`, small: `RABJUNG ${t.rabjung} · YEAR ${t.rabjungYear} OF 60`, caption: '60 YEARS · THE RABJUNG, COUNTED FROM 1027' }, cells(
      cell('DATE', `${t.leap ? 'LEAP ' : ''}MONTH ${t.month} · DAY ${t.day}${t.repeated ? ' (REPEATED)' : ''}`, 'date', 'PHUGPA · READ AT DAWN, LHASA'),
      cell('YEAR', `${t.element}-${t.gender}-${t.animal}`, 'year', `RABJUNG ${t.rabjung}, YEAR ${t.rabjungYear}`),
    ), t);
  }
};
