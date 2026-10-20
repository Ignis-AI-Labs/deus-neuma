/**
 * MANY SKIES — the whole Vedic chart from the instant (wave 1b,
 * docs/architecture/identity/many-skies-vedic.md). Beside the v1 `jyotisha`
 * block (which stays exactly as it is — the aura reads its nakshatra):
 *
 *   grahas    — the nine: Sun…Saturn sidereal (Lahiri, the IAE mean), Rahu by
 *               the MEAN node (Meeus — the Drik and IAE default) with the TRUE
 *               (osculating) node beside it, Ketu opposite; each with its rashi,
 *               nakshatra, pada, navamsa (D9) and whether it is vargottama.
 *               Uranus, Neptune and Pluto are not grahas.
 *   moon      — its nakshatra's lord, deity, gana, yoni, nadi, symbol, and its
 *               Nāmakaraṇa syllable.
 *   panchanga — the tithi and yoga by name (tātkālika — at the instant).
 *   dasha     — the Vimshottari timeline: the nine mahadashas from the notional
 *               start before birth, and the bhuktis of the one in force, in
 *               years of 365.25 days (labelled; others exist).
 *   calendar  — the lunar month (amānta and pūrṇimānta, adhika marked), the
 *               years (Shaka, Vikram, Gujarati, Kali), the samvatsara (southern
 *               and northern), the ritu and ayana (each two ways).
 * The vargas (D2…D60) are a pure function of a longitude — `vargaSign` — so a
 * surface draws any of them from the grahas here. Varna is not computed.
 * Pure.
 */
import * as Astronomy from 'astronomy-engine';
import { eclipticLongitude, computeCelestialPositions } from '../natal-chart.js';
import { ayanamsaDeg, NAKSHATRAS, RASHIS, DASHA_LORDS, DASHA_YEARS } from './jyotisha.js';
import { NAMAKARANA } from './namakarana.js';
import { NAKSHATRA_INFO, YOGAS, tithiName, MASAS, RITUS, SAMVATSARAS, GRAHA_NAMES } from './vedic-tables.js';

const DAY = 86400000;
const SPAN = 360 / 27;
const PADA = SPAN / 4;
const norm = (d) => ((d % 360) + 360) % 360;
const round = (n, p = 4) => Math.round(n * 10 ** p) / 10 ** p;
const DASHA_YEAR_DAYS = 365.25;

/** The varga (divisional) sign of a sidereal longitude, by the Parashari rules (BPHS ch.6). Pure. */
export const vargaSign = (lon, n) => {
  const s = Math.floor(norm(lon) / 30);
  const d = norm(lon) - s * 30;
  const k = Math.floor((d * n) / 30);
  const odd = s % 2 === 0; // Aries, Gemini … are the odd signs
  const kind = s % 3; // 0 movable, 1 fixed, 2 dual
  switch (n) {
    case 1: return s;
    case 2: return odd === (d < 15) ? 4 : 3; // odd: first half Leo; even: first half Cancer
    case 3: return (s + 4 * k) % 12;
    case 4: return (s + 3 * k) % 12;
    case 7: return (odd ? s + k : s + 6 + k) % 12;
    case 9: return Math.floor(norm(lon) / (10 / 3)) % 12;
    case 10: return (odd ? s + k : s + 8 + k) % 12;
    case 12: return (s + k) % 12;
    case 16: return ([0, 4, 8][kind] + k) % 12;
    case 20: return ([0, 8, 4][kind] + k) % 12;
    case 24: return ((odd ? 4 : 3) + k) % 12;
    case 27: return ([0, 3, 6, 9][s % 4] + k) % 12;
    case 30: {
      const bands = odd ? [[5, 0], [10, 10], [18, 8], [25, 2], [30, 6]] : [[5, 1], [12, 5], [20, 11], [25, 9], [30, 7]];
      return bands.find(([upTo]) => d < upTo)[1];
    }
    case 40: return ((odd ? 0 : 6) + k) % 12;
    case 45: return ([0, 4, 8][kind] + k) % 12;
    case 60: return (s + Math.floor(2 * d)) % 12;
    default: throw new Error(`no Parashari rule for D${n}`);
  }
};
export const SHODASAVARGA = Object.freeze([1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60]);

const placed = (key, sidereal, retrograde) => {
  const n = Math.floor(sidereal / SPAN);
  const rashi = Math.floor(sidereal / 30);
  const navamsa = vargaSign(sidereal, 9);
  return Object.freeze({
    key, name: GRAHA_NAMES[key], sidereal: round(sidereal), rashi: RASHIS[rashi], degree: round(sidereal - rashi * 30),
    nakshatra: NAKSHATRAS[n], pada: Math.floor((sidereal % SPAN) / PADA) + 1, navamsa: RASHIS[navamsa], vargottama: navamsa === rashi, retrograde,
  });
};

/** The mean lunar node (Rahu), tropical, by Meeus ch.22. Pure. */
export const meanRahu = (date) => {
  const T = Astronomy.MakeTime(date).tt / 36525;
  return norm(125.04452 - 1934.136261 * T + 0.0020708 * T * T + (T * T * T) / 450000);
};

/** The true (osculating) lunar node, tropical: the node of the Moon's instantaneous orbit. Pure. */
export const trueRahu = (date) => {
  const time = Astronomy.MakeTime(date);
  const st = Astronomy.RotateState(Astronomy.Rotation_EQJ_ECT(time), Astronomy.GeoMoonState(time));
  const hx = st.y * st.vz - st.z * st.vy;
  const hy = st.z * st.vx - st.x * st.vz;
  return norm(Math.atan2(hx, -hy) * 180 / Math.PI);
};

/** The nine grahas at an instant, sidereal. Pure. */
export const grahasOf = (date) => {
  const aya = ayanamsaDeg(date);
  const pos = computeCelestialPositions(date);
  const out = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'].map((k) => placed(k, norm(pos[k].longitude - aya), pos[k].retrograde));
  const rahu = norm(meanRahu(date) - aya);
  out.push(placed('rahu', rahu, true), placed('ketu', norm(rahu + 180), true));
  const trueNode = norm(trueRahu(date) - aya);
  return { grahas: Object.freeze(out), trueRahu: Object.freeze({ sidereal: round(trueNode), rashi: RASHIS[Math.floor(trueNode / 30)], nakshatra: NAKSHATRAS[Math.floor(trueNode / SPAN)] }) };
};

/** The Vimshottari timeline from the Moon's sidereal longitude: mahadashas, and the bhuktis of the one in force at birth. Pure. */
export const vimshottari = (moonSid, birthMs, yearDays = DASHA_YEAR_DAYS) => {
  const n = Math.floor(moonSid / SPAN);
  const first = n % 9;
  const elapsed = (moonSid % SPAN) / SPAN;
  const Y = yearDays * DAY;
  let t = birthMs - elapsed * DASHA_YEARS[DASHA_LORDS[first]] * Y; // the notional start, before birth
  const mahadashas = [];
  for (let i = 0; i < 9; i += 1) {
    const lord = DASHA_LORDS[(first + i) % 9];
    const span = DASHA_YEARS[lord] * Y;
    mahadashas.push(Object.freeze({ lord, years: DASHA_YEARS[lord], start: new Date(t).toISOString(), end: new Date(t + span).toISOString() }));
    t += span;
  }
  // the bhuktis of the first mahadasha (the one in force at birth): each L·S/120 years, from its own lord
  const md = mahadashas[0];
  let b = Date.parse(md.start);
  const bhuktis = [];
  for (let i = 0; i < 9; i += 1) {
    const lord = DASHA_LORDS[(first + i) % 9];
    const span = ((DASHA_YEARS[md.lord] * DASHA_YEARS[lord]) / 120) * Y;
    bhuktis.push(Object.freeze({ lord, start: new Date(b).toISOString(), end: new Date(b + span).toISOString() }));
    b += span;
  }
  return Object.freeze({ yearDays, mahadashas: Object.freeze(mahadashas), bhuktis: Object.freeze(bhuktis), atBirth: bhuktis.find((x) => Date.parse(x.end) > birthMs)?.lord ?? null });
};

const sidSunAt = (date) => norm(eclipticLongitude(Astronomy.Body.Sun, date) - ayanamsaDeg(date));
const newMoonBefore = (date) => {
  let t = new Date(date.getTime() - 32 * DAY);
  let last = null;
  for (;;) {
    const nm = Astronomy.SearchMoonPhase(0, t, 40).date;
    if (nm > date) return last;
    last = nm;
    t = new Date(nm.getTime() + DAY);
  }
};
/** The instant the sidereal Sun enters Mesha (Mesha sankranti) in a Gregorian year. Pure. */
const meshaSankranti = (year) => {
  // the tropical longitude the Sun must reach is the ayanamsa itself (~24°, mid-April); it drifts 50″ a year, so one pass refines it
  const guess = Astronomy.SearchSunLongitude(norm(ayanamsaDeg(new Date(Date.UTC(year, 3, 14)))), new Date(Date.UTC(year, 3, 1)), 30).date;
  return Astronomy.SearchSunLongitude(norm(ayanamsaDeg(guess)), new Date(guess.getTime() - 2 * DAY), 4).date;
};
// the first new moon with the sidereal Sun in Meena before Mesha sankranti — the year's first Chaitra (adhika or nija)
const chaitraStart = (year) => {
  const ms = meshaSankranti(year);
  let nm = newMoonBefore(ms);
  for (let prev = newMoonBefore(new Date(nm.getTime() - DAY)); prev && Math.floor(sidSunAt(prev) / 30) === 11; prev = newMoonBefore(new Date(prev.getTime() - DAY))) nm = prev;
  return nm;
};

/** The lunar month, years, samvatsaras, ritu and ayana of an instant — tātkālika. Pure. */
export const vedicCalendar = (date, tithi) => {
  const nm = newMoonBefore(date);
  const next = Astronomy.SearchMoonPhase(0, new Date(nm.getTime() + DAY), 40).date;
  const s1 = Math.floor(sidSunAt(nm) / 30);
  const s2 = Math.floor(sidSunAt(next) / 30);
  const amanta = (s1 + 1) % 12;
  const adhika = s1 === s2;
  const purnimanta = tithi >= 16 ? (adhika ? amanta : (amanta + 1) % 12) : amanta;
  const y = date.getUTCFullYear();
  const shaka = date >= chaitraStart(y) ? y - 78 : y - 79;
  const vikram = shaka + 135;
  // Gujarati (Kārtikādi): the year turns at the new moon opening amānta Kartika (the Sun in Tula)
  const kartikaOfYear = (() => { let t = new Date(Date.UTC(y, 9, 1)); for (;;) { const m = Astronomy.SearchMoonPhase(0, t, 40).date; if (Math.floor(sidSunAt(m) / 30) === 6) return m; t = new Date(m.getTime() + DAY); } })();
  const gujarati = date >= kartikaOfYear || date < chaitraStart(y) ? vikram : vikram - 1;
  // the northern (Jovian) samvatsara — Sewell & Dikshit Art.59c
  const solarYear = date >= meshaSankranti(y) ? y : y - 1;
  const ms = meshaSankranti(solarYear);
  const k = solarYear + 3101; // expired Kali years at that Mesha sankranti
  const q = Math.floor((117 * k - 60) / 10000);
  const rem = (117 * k - 60) % 10000;
  const N = ((k + 27 + q - 1) % 60) + 1;
  const endN = ms.getTime() + ((10000 - rem) * 361 / 10000) * DAY + 6 * 60000;
  const northNow = date.getTime() < endN ? N : (N % 60) + 1 + (date.getTime() >= endN + 361.026721 * DAY ? 1 : 0);
  const tropSun = eclipticLongitude(Astronomy.Body.Sun, date);
  const sidSun = sidSunAt(date);
  return Object.freeze({
    masa: Object.freeze({ amanta: MASAS[amanta], purnimanta: MASAS[purnimanta], adhika }),
    years: Object.freeze({ shaka, vikram, gujarati, kali: shaka + 3179 }),
    samvatsara: Object.freeze({
      southern: SAMVATSARAS[(shaka + 11) % 60],
      northern: SAMVATSARAS[N - 1], // the name of the Vikram year (current at Mesha sankranti)
      northernNow: SAMVATSARAS[((northNow - 1) % 60 + 60) % 60],
    }),
    ritu: Object.freeze({ vedic: RITUS[Math.floor(amanta / 2)], drik: RITUS[Math.floor(norm(tropSun + 30) / 60)] }),
    ayana: Object.freeze({ tropical: tropSun >= 270 || tropSun < 90 ? 'Uttarayana' : 'Dakshinayana', sidereal: sidSun >= 270 || sidSun < 90 ? 'Uttarayana' : 'Dakshinayana' }),
  });
};

/** The Vedic block of one birth. Pure. */
export const vedic = (date, jyotishaBlock) => {
  const { grahas, trueRahu: trueNode } = grahasOf(date);
  const moon = grahas[1];
  const n = NAKSHATRAS.indexOf(moon.nakshatra);
  const tithi = jyotishaBlock?.tithi?.number;
  return {
    provenance: {
      kind: 'ancient-living',
      ayanamsa: 'Lahiri — IAE 1985 / Swiss Ephemeris mean',
      note: 'Rahu by the mean node (Drik/IAE default; the true node beside it); panchanga values at the instant (tātkālika) — a printed panchanga labels each day by its sunrise value; Vimshottari years of 365.25 days; masa named by the solar month of its opening new moon; varna not computed',
    },
    grahas,
    trueRahu: trueNode,
    moon: Object.freeze({ ...NAKSHATRA_INFO[n], syllable: NAMAKARANA[n].padas[moon.pada - 1] }),
    panchanga: Object.freeze({ tithi: tithi ? tithiName(tithi) : null, yoga: jyotishaBlock?.yoga ? YOGAS[jyotishaBlock.yoga.index - 1] : null }),
    dasha: vimshottari(moon.sidereal, date.getTime()),
    calendar: tithi ? vedicCalendar(date, tithi) : null,
  };
};
