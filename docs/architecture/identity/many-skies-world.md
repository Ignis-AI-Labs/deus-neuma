# MANY SKIES — THE WORLD: every objective sky, ancient or modern

*Research record, 2026-10-19. A companion to [many-skies.md](./many-skies.md):
read its §0 doctrine, §2.4 shortlist and exclusions first. This record covers the
world's other calendars and birth systems. For each one it gives the method, the
tables, the contested conventions, published test vectors and a ship verdict.
Nothing here is implemented yet. It is the evidence an implementation stands on.*

---

## 0. The rule this record applies

**The inclusion rule (2026-10-19).** Any system, ancient or modern, is included
only if both of these hold:

1. **It has objective grounds.** That means a fixed, published, reproducible
   method that runs from the instant, the sky, or the date.
2. **It is not a copy-and-paste of a system already shown.** A variant becomes
   a note on its parent.

Further requirements:

- Modern systems carry their author and year.
- Outputs bound to a place go **only to the private, encrypted path**, and are
  marked NEEDS-LOCATION.
- Systems that cannot be computed by design stay excluded, and the reason is
  written down.

**Doctrine carried over from many-skies.md §0.**
- Every output is deterministic from the sealed UTC instant, plus the sealed
  timezone offset when the local civil date is needed.
- Provenance is first-class data.
- Contested conventions are labelled and never silently picked.
- Nothing is invented.

### 0.1 Verdict legend

| Verdict | Meaning |
|---|---|
| **SHIP** | Objective, distinct, uncontested enough to compute as-is. It still carries its provenance label. |
| **SHIP-LABELLED** | Objective and distinct, but a convention is contested (epoch, correlation, meridian, day boundary). Compute it under a *named* convention and print the alternatives. |
| **NOTE-ON-PARENT** | A variant or rendering of a system already shown, or recommended here. It appears as a labelled line inside the parent's block, never as its own system. |
| **NEEDS-LOCATION** | Computable only with the birth place (sunrise, sunset, horizon). Private encrypted natal path only. |
| **DO-NOT-SHIP** | No objective method, no agreed anchor, a dead calendar extrapolated past its evidence, invented bodies, or a fabrication. The reason is recorded. |

**Provenance kinds** (the same vocabulary the engine already uses):
- `ancient-living`
- `ancient-reconstructed`
- `ancient-transformed`
- `modern` (with author and year)

### 0.2 Test-vector policy

- **A "published vector" is a date pair quoted from the cited source.** It is
  never a value we computed.
- Where this record says a set of published pairs "fit one rule", we checked the
  residues ourselves (a scratch script, 2026-10-19). That check verifies the
  rule; it is **not** a vector.
- The pairs checked that way:
  - Igbo `JDN mod 4`;
  - Akan `JDN mod 42 = 41` for Akwasidae;
  - Shahanshahi and Kadmi epochs;
  - Ethiopic (R&D);
  - Egyptian (Nabonassar);
  - Maya 819-day stations.
- **Main algorithmic reference:** Reingold & Dershowitz, *Calendrical
  Calculations* (hereafter R&D). The official code is public under Apache-2.0 at
  https://github.com/EdReingold/calendar-code2 (`calendar.l`, sample dates
  `dates.l`). The Appendix C sample-date values are mirrored in
  https://github.com/espinielli/pycalcal (`dates1.tex`, `dates2.tex`).
- **Caveat:** R&D says its sample values are […]
  (https://www.cambridge.org/core/books/abs/calendrical-calculations/sample-data/DF61215350B5BB1E3661D6D8827120C9).

### 0.3 What astronomy-engine can and cannot do

Checked in `node_modules/astronomy-engine` v2.1.19:

| Can do | Notes |
|---|---|
| `Body`: Sun, Moon, Mercury–Pluto, plus SSB and EMB | `DefineStar` gives up to **8** user-defined stars (`Star1..Star8`). |
| `Seasons(year)` | Equinoxes and solstices. Needed for the Jalali, Bahá'í and French Republican years. |
| `SearchSunLongitude` | For the Human Design "design" instant and solar terms. |
| `SearchMoonPhase`, `SearchMoonQuarter` | For the syzygy and lunar phase. |
| `SearchRiseSet`, `SearchHourAngle` | For fixed-meridian rules and location-bound outputs. |
| `HelioVector` | For heliocentric positions. |
| `SearchMoonNode` | Returns node-crossing *times* only, not a node longitude. |

**Cannot do:**
- Chiron, Ceres, Pallas, Juno, Vesta, or any asteroid or centaur.
- Mean or true lunar node longitude. Use Meeus ch. 47 instead (§B.8).

**Trap (does not bite us):** `Astronomy.EclipticLongitude(body, date)` is
**heliocentric**. `core/cosmos/natal-chart.js` already uses `SunPosition` and
`GeoVector` → `Rotation_EQJ_ECT` correctly. Any new code must use the natal
helper, not `Astronomy.EclipticLongitude`.

---

## 1. Verdict summary (every item in this record)

| § | System | Provenance | Needs location | Verdict |
|---|---|---|---|---|
| A1 | Hebrew calendar date | ancient-living | edge only (after-sunset births) | **SHIP-LABELLED** |
| A1 | Shabbat 156a weekday teaching | ancient-living, internally contested | edge only | **SHIP-LABELLED** (attested teaching + its counter-position) |
| A1 | R. Ḥanina's hour-mazal | ancient (same Chaldean hours as the Hellenistic scheme) | yes | **NOTE-ON-PARENT** + **NEEDS-LOCATION** |
| A2 | Hijri: Umm al-Qura | modern official (KACST) | edge only | **SHIP-LABELLED** (primary Hijri line) |
| A2 | Hijri: tabular (type II, Friday epoch) | medieval-living | edge only | **NOTE-ON-PARENT** |
| A2 | Hijri: local sighting | ancient-living | yes, plus testimony | **DO-NOT-SHIP** (not predictable) |
| A3 | Persian Solar Hijri (Jalali) | medieval reform, modern official 1925 | no | **SHIP** (meridian labelled) |
| A4 | Zoroastrian: Shahanshahi, Kadmi, Fasli + roz/yazata | ancient-living (Fasli modern-1906) | edge only (pre-dawn) | **SHIP** one block: Shahanshahi line + Kadmi/Fasli labelled variant lines |
| A5 | Ethiopian (Amete Mihret) | ancient-living | no | **SHIP** |
| A5 | Coptic (Anno Martyrum) | ancient-living | no | **NOTE-ON-PARENT** (same month and day as Ethiopian; own names and era) |
| A6 | Arabic lunar mansions (28 equal, tropical) | ancient-transformed | no | **SHIP-LABELLED**. This **reverses** many-skies.md §2.4's "near-duplicate". |
| A6 | Anwāʾ star calendar | ancient | yes (latitude, sighting) | **NOTE-ON-PARENT** (history only) |
| A7 | Egyptian civil wandering year (Nabonassar era) | ancient-reconstructed | no | **SHIP-LABELLED** |
| A8 | Babylonian lunisolar date | ancient-reconstructed, dead after 75 CE | fixed Babylon | **DO-NOT-SHIP** |
| A8 | Babylonian sidereal zodiac (Fagan-Bradley / Huber / Britton) | contested | no | **NOTE-ON-PARENT** (an ayanamsa variant under Jyotisha) |
| A9 | Igbo izu (4-day market day) | ancient-living | no | **SHIP-LABELLED** |
| A9 | Igbo izu ukwu phase, Igbo year | ancient-living | — | **DO-NOT-SHIP** (no common anchor) |
| A9 | Yoruba 4-day Ọ̀sẹ̀ | ancient-living | — | **DO-NOT-SHIP** (anchors disagree by 2 days) |
| A9 | Yoruba Kọ́jọ́dá year number | modern (Alaran) | no | **SHIP-LABELLED, civil-locked class** (§C.0) |
| A9 | Akan 42-day adaduanan (nnanson × weekday) | ancient-living | no | **SHIP** (inside the existing Akan block) |
| A10 | Aztec xiuhpohualli | ancient-reconstructed, contested | no | **SHIP-LABELLED, HELD** until a third independent vector |
| A10 | Maya 819-day count | ancient-reconstructed | no | **SHIP-LABELLED** (inside the Maya/GMT block) |
| A11 | Graves tree calendar | modern (Graves 1948) | no | **SHIP-LABELLED, civil-locked class** (§C.0) |
| A11 | "Celtic/Gaulish tree horoscope" (21 trees) | modern (Delsol 1971) | no | **DO-NOT-SHIP** (table unverified; claim rests on a false attribution) |
| A11 | Old Icelandic calendar (misseri) | ancient-living | no | **SHIP** |
| A11 | Swedish runic calendar, Norwegian primstav | medieval | no | **NOTE-ON-PARENT** (Julian computus) |
| A11 | Coligny (Gaulish) | ancient-reconstructed | — | **DO-NOT-SHIP** (no agreed alignment) |
| A11 | […] | modern fabrication | — | **DO-NOT-SHIP** |
| B1 | Human Design 64-gate wheel + design chart | modern (Krakower "Ra Uru Hu", 1987/1992) | no | **SHIP-LABELLED** (sequence verified, own texts) |
| B2 | Gene Keys | modern (Rudd 2009) | no | **NOTE-ON-PARENT** (Human Design) |
| B3 | Numerology life path | modern (Balliett 1905/1908) | — | **DO-NOT-SHIP** (methods conflict; a digit artefact) |
| B4 | Sabian degree index | modern (Jones & Wheeler 1925) | no | **SHIP** (index 1–360 + our own texts; never Jones/Rudhyar wording) |
| B5 | 13-Moon calendar | modern (Argüelles 1987–92) | Feb 29 edge | **NOTE-ON-PARENT** (Dreamspell) |
| B6 | Midpoints / 90° dial | modern (Witte 1928; Ebertin 1940) | only with ASC/MC | **NOTE-ON-PARENT** (derived view of the Western chart) |
| B6 | Uranian hypothetical planets | modern (Witte; Sieggrün 1927) | — | **DO-NOT-SHIP** (the bodies do not exist) |
| B7 | Heliocentric longitudes | modern | no | **NOTE-ON-PARENT** |
| B8 | Mean lunar node, mean apogee ("Black Moon Lilith") | Meeus | no | **SHIP-LABELLED** (Western chart addition; mean/true labelled) |
| B8 | Chiron and the asteroids | — | no | **DO-NOT-SHIP now** (no ephemeris; a new dependency would be needed) |
| B9 | Lunar phase at birth | astronomical (Rudhyar 1967 for the 8-family names) | no | **SHIP-LABELLED** (bounds to verify) |
| B9 | Prenatal syzygy | ancient (Ptolemy, *Tetrabiblos* III.2) | full-moon pick only | **SHIP-LABELLED** |
| B9 | Fixed stars / Galactic Center | catalogue-based | no | **SHIP-LABELLED, phase 2** |
| B9 | Harmonics, draconic, solar return | modern / traditional | — | **NOTE-ON-PARENT** |
| B9 | Lots, profections | Hellenistic | yes | **NEEDS-LOCATION** (already deferred in `index.js`) |
| B9 | Tertiary progressions | modern | — | **DO-NOT-SHIP** (forecasting, not the birth instant) |
| C | 24 solar terms + 72 pentads | ancient-living | no | **SHIP-LABELLED** |
| C | Chinese lunisolar date (GB/T 33661-2017) | ancient-living | no | **SHIP-LABELLED** (owned by many-skies-east-asia.md §1; parent for Korean, Vietnamese, kyūreki, rokuyō) |
| C | Bahá'í Badíʿ calendar | modern (1873; Tehran rule 2015) | edge only (after sunset) | **SHIP-LABELLED** |
| C | Burmese lunisolar date | ancient-living (Yan Naing Aye's algorithm, 2013) | no | **SHIP-LABELLED** |
| C | French Republican calendar | modern (Romme, Fabre d'Églantine 1793) | no | **SHIP-LABELLED** |
| C | Japanese era (nengō) | ancient-living, statutory | no | **SHIP-LABELLED** (official table) |
| C | Indian National (Saka 1957), Bangladesh Bangabda (1987/2019), Mool Nanakshahi (2003) | modern | no | **SHIP-LABELLED, civil-locked class** (§C.0) |
| C | Thai lunar | ancient-living | no | **SHIP-LABELLED, low priority** |
| C | Hindu lunisolar month (amanta/purnimanta), Nepal Sambat, Jain VNS, Kali ahargana, Bikram Sambat, Hindu regional solar calendars | ancient-living | some (day rules) | **NOTE-ON-PARENT** (Jyotisha) |
| C | Korean, Vietnamese, kyūreki, rokuyō, Japanese 72 kō | ancient-living | no | **NOTE-ON-PARENT** (Chinese lunisolar / solar terms) |
| C | Armenian, Mandaean | ancient-living | no | **NOTE-ON-PARENT** (Egyptian wandering-year kernel; Mandaean anchor in conflict) |
| C | Julian, Berber/Amazigh, Thai BE, Mongolian, Uyghur 12-animal | — | no | **NOTE-ON-PARENT** |
| C | Hindu muhūrta / choghadiya | ancient-living | yes | **NEEDS-LOCATION** |
| C | Hawaiian kaulana mahina, Tahitian moon nights | ancient-living | sighting | **DO-NOT-SHIP** (night 1 = crescent sighting; no published computational anchor) |
| C | Māori maramataka / Matariki, Andean/Inca, Aboriginal seasonal, Native American winter counts and "moon names", Hopi, Malagasy vintana, Inuit, Muisca | — | — | **DO-NOT-SHIP** |

---

## A. Exact research: the ancient and living calendars

### A1. Hebrew calendar + Shabbat 156a

**What it is.** A fixed lunisolar calendar driven by the mean new moon (*molad*).
- 7 leap months in every 19 years.
- Fixed arithmetic attributed to Hillel II (4th century), finalized by the 10th
  century. R&D, IAJGS paper:
  https://www.cs.tau.ac.il/~nachum/calendar-book/papers/IAJGS-Conference.pdf
- **Provenance:** `ancient-living`.

**Algorithm.** R&D `calendar.l`; Wikipedia https://en.wikipedia.org/wiki/Hebrew_calendar.

| Item | Value |
|---|---|
| Parts (*ḥalakim*) | 1080 per hour = 25,920 per day. 1 part = 3⅓ s. |
| Mean month | 29 d 12 h 793 p |
| Epoch molad (BaHaRaD) | Day 2, 5 h, 204 p |
| Fixed epoch | 1 Tishri AM 1 = **RD −1,373,427** = Mon 7 Oct 3761 BCE (Julian) |
| Leap years | Cycle years 3, 6, 8, 11, 14, 17, 19. R&D: leap ⇔ `(7y+1) mod 19 < 7`. |
| Months elapsed before year y | ⌊(235y − 234)/19⌋ |

**The four postponements (dehiyyot) of 1 Tishri.** Hours are counted from 6 pm.
Source: Rambam, *Kiddush HaChodesh* 7:1–5,
https://www.sefaria.org/Mishneh_Torah,_Sanctification_of_the_New_Month.7

| Rule | Threshold |
|---|---|
| Lo ADU Rosh | Molad on Sun, Wed or Fri → postpone 1 day |
| Molad Zaken | Molad ≥ 18 h (noon) → next day, then apply ADU again |
| GaTaRaD | Common year, molad on Tue ≥ 9 h 204 p → Thu |
| BeTUTaKPaT | Year after a leap year, molad on Mon ≥ 15 h 589 p → Tue |

R&D implements the last two through `hebrew-year-length-correction`.

**Year lengths:** 353/354/355 (common) and 383/384/385 (leap). These are the
deficient, regular and complete kinds. Ḥeshvan/Kislev = 29/29, 29/30 or 30/30.

**Months.** R&D and hebcal number from Nisan.

| No. | Month | Days |
|---|---|---|
| 1 | Nisan | 30 |
| 2 | Iyyar | 29 |
| 3 | Sivan | 30 |
| 4 | Tammuz | 29 |
| 5 | Av | 30 |
| 6 | Elul | 29 |
| 7 | Tishri | 30 |
| 8 | Ḥeshvan | 29/30 |
| 9 | Kislev | 30/29 |
| 10 | Tevet | 29 |
| 11 | Shevat | 30 |
| 12 | Adar (common) / Adar I (leap) | 29 / 30 |
| 13 | Adar II (leap only) | 29 |

**Contested conventions (label both):**
1. **Month numbering.** Nisan = 1 (biblical; R&D, hebcal) or Tishri = 1 (civil
   order). The year number changes at 1 Tishri either way.
2. **Day boundary.** The Hebrew day runs **from sunset**.
   - R&D's convention: civil date *i* maps to the Hebrew day whose daylight
     falls on *i*. hebcal's `afterSunset:false` default does the same.
   - R&D on births: […].
   - Ship the civil-date convention, labelled. The after-sunset correction is
     **NEEDS-LOCATION** and goes to the private path.

**Published vectors:**

| Hebrew | Gregorian | Source |
|---|---|---|
| 1 Tishri 5785 | 3 Oct 2024 | hebcal API `converter?cfg=json&hy=5785&hm=Tishrei&hd=1&h2g=1` |
| 1 Tishri 5786 | 23 Sep 2025 | hebcal API |
| 14 Adar II 5784 (Purim) | 24 Mar 2024 | hebcal API |
| 1 Adar I 5784 | 10 Feb 2024 | hebcal API |
| 12 Nisan 5599 | 27 Mar 1839 | R&D `dates.l` (Hebrew side); hebcal (Gregorian side) |

**Shabbat 156a: the weekday teaching.** Source: https://www.sefaria.org/Shabbat.156a.
It is introduced as written […]. Each trait
is tied to that day of creation.

| Born on | Trait (Sefaria's translation, quoted) | Reason given |
|---|---|---|
| 1st day | […] (wholly for good or wholly for ill) | light and darkness were created |
| 2nd | "a short-tempered person" | the waters were divided |
| 3rd | […] | vegetation, abundant and mixed |
| 4th | […] | the lights were hung |
| 5th | […] | fish and fowl live by kindness |
| 6th | "a seeker". Rav Naḥman bar Yitzḥak: "of mitzvot". | — |
| Shabbat | […]. Rava bar Rav Sheila: […]. | — |

**The internal debate is part of the data. Ship it with the teaching.**
- R. Ḥanina: […],
  and *yesh mazal le-Yisrael*.
- R. Yoḥanan: *ein mazal le-Yisrael* (Jer. 10:2). Rav agrees ([…]).

**Hour-mazal: same as the Hellenistic planetary hours.**
- R. Ḥanina gives traits by planet: Sun "radiant"; Venus "rich and promiscuous";
  Mercury "enlightened and expert"; Moon "builds and destroys"; Saturn […]; Jupiter "just"; Mars "spills blood".
- The order is ShaTZaM ChaNKaL, the Chaldean order.
- Rashi on Berakhot 59b (https://www.sefaria.org/Rashi_on_Berakhot.59b) gives
  the night rulers כצנ״ש חל״ם. These match the Hellenistic scheme exactly (we
  checked): Saturday night = Mercury, Sunday night = Jupiter.
- Hours are unequal (sunrise and sunset), so this is **NOTE-ON-PARENT** on a
  future planetary-hour output, **NEEDS-LOCATION**. Show the Talmud's trait list
  as an attestation line. Do not build a separate computation.

**Licence flag.** Sefaria's English Talmud translation carries its own licence;
our reading is that it is non-commercial. Verify before quoting it in product
surfaces. The safe path is our own rendering of the Aramaic, with the folio
cited.

**Verdicts.**
- Hebrew date: **SHIP-LABELLED** (civil-date convention, numbering convention).
- Weekday teaching: **SHIP-LABELLED**, shown with the debate. The Hebrew weekday
  turns at sunset; that edge is labelled.
- Hour-mazal: **NOTE-ON-PARENT** + **NEEDS-LOCATION**.

### A2. Islamic Hijri

**Months:** Muḥarram, Ṣafar, Rabīʿ al-Awwal, Rabīʿ al-Thānī, Jumādā al-Ūlā,
Jumādā al-Ākhira, Rajab, Shaʿbān, Ramaḍān, Shawwāl, Dhū al-Qaʿda, Dhū al-Ḥijja.
The day begins at sunset, which raises the same labelling issue as A1.

**(a) Tabular.** Source:
https://webspace.science.uu.nl/~gent0113/islam/islam_tabcal_variants.htm
- Odd months have 30 days, even months 29. A leap year gives Dhū al-Ḥijja 30.
- **Epoch is contested:**
  - 16 Jul 622 Julian (civil, "Friday"). R&D uses this: RD 227015.
  - 15 Jul 622 (astronomical, "Thursday").

| Type | Leap years in the 30-year cycle | Attested use |
|---|---|---|
| I | 2, 5, 7, 10, 13, 15, 18, 21, 24, 26, 29 | Kūshyār, Ulugh Beg |
| II (most common) | 2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29 | al-Khwārizmī, al-Battānī, Alfonsine Tables. R&D: leap ⇔ `(14+11y) mod 30 < 11`. |
| III | 2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29 | Fāṭimid, Ismāʿīlī, Bohorā |
| IV | 2, 5, 8, 11, 13, 16, 19, 21, 24, 27, 30 | Ḥabash al-Ḥāsib, al-Bīrūnī |

**Correction:** Microsoft's "Kuwaiti algorithm" is type II with the
**Thursday** epoch. Van Gent calls it IIa:
https://webspace.science.uu.nl/~gent0113/islam/islam_tabcal_others.htm

**Published vectors.** Gregorian inputs are R&D `dates.l` sample dates. Hijri
values are from ICU4X test data,
https://github.com/unicode-org/icu4x/blob/main/components/calendar/src/cal/hijri.rs

| Gregorian | Type II, Friday epoch | Type II, Thursday epoch |
|---|---|---|
| 1992-03-17 | 1412-09-13 | 1412-09-14 |
| 1996-02-25 | 1416-10-05 | 1416-10-06 |
| 2038-11-10 | 1460-10-12 | 1460-10-13 |
| 2094-07-18 | 1518-03-05 | 1518-03-06 |

**(b) Umm al-Qura** (Saudi official civil calendar, computed for Mecca).
Source: https://webspace.science.uu.nl/~gent0113/islam/ummalqura_rules.htm

| Period | Rule |
|---|---|
| Since 1423 AH (2002) | On the 29th, the next day begins the month if (1) the geocentric conjunction occurs **before sunset at Mecca** and (2) the **Moon sets after the Sun**. Otherwise the month runs 30 days. |
| 1420–1422 AH | Moonset after sunset only |
| 1392–1419 AH | New moon within 3 h after Saudi midnight |
| Before 1392 AH | Uncertain |

- **Table:** KACST month lengths, as shipped by ICU4X/CLDR `islamic-umalqura`,
  cover **1300–1600 AH (1882-11-12 → 2174-11-25)**.
- Van Gent: […]. Religious dates announced by
  sighting sometimes differ by a day (e.g. 1 Ramaḍān 1439: computed 16 May 2018,
  announced 17 May 2018).

| Hijri | Gregorian | Source |
|---|---|---|
| 1 Ramaḍān 1445 | 11 Mar 2024 | van Gent (computed = announced); Wikipedia "Ramadan" |
| 1 Muḥarram 1446 | 7 Jul 2024 | van Gent. Wikipedia's 8 Jul comes from a non-Umm-al-Qura "global" calendar. |
| 1 Shawwāl 1444 | 21 Apr 2023 | van Gent; Wikipedia "Eid al-Fitr" |
| 1 Ramaḍān 1446 / 1 Shawwāl 1446 | 1 Mar 2025 / 30 Mar 2025 | van Gent; Wikipedia |
| 1992-03-17 | 1412-09-12 | ICU4X `UMMALQURA_CASES` |

**Implementation recommendation.** Use the KACST table as the source of truth.
It is official, published and deterministic. Mecca is a fixed reference point,
not the being's location, so the result is plaintext. The post-1423 rule can be
recomputed with astronomy-engine as a cross-check only.

**(c) Sighting.** It depends on community, testimony and weather. R&D: computations
are "just (close) approximations". **DO-NOT-SHIP** as a value. At most, print the
note: […].

**Verdicts.**
- Umm al-Qura: **SHIP-LABELLED** as the primary Hijri line. Labels: […]; pre-1423 rules differ; religious announcements
  may differ; sunset edge.
- Tabular: **NOTE-ON-PARENT**, naming type and epoch (default II, Friday).
- Sighting: **DO-NOT-SHIP**.

### A3. Persian Solar Hijri (Jalali)

**What it is.** The Jalali reform (1079 CE) of a solar year beginning at the
March equinox. Adopted by Iran's parliament on 31 Mar 1925 (11 Farvardin 1304).
Sources: Heydari-Malayeri, https://arxiv.org/pdf/astro-ph/0409620;
https://en.wikipedia.org/wiki/Solar_Hijri_calendar
- **Provenance:** `ancient-living` (medieval reform, modern official).

**Rule.**
- 1 Farvardin is the day on which the equinox falls **before noon**. If the
  equinox is after noon, the year begins the next day.
- The day begins at midnight, so the local civil date is exact.
- Epoch: 1 Farvardin 1 AP = 19 Mar 622 (Julian), per R&D.

**Contested: which noon.**

| Source | Noon reference |
|---|---|
| The Iranian calendar authority (University of Tehran, Geophysics Institute) and current practice | **52.5°E** (the Iran Standard Time meridian, UTC+3:30, i.e. 08:30 UTC). Pournader's implementation matches the authority's leap table for 1206–1498 AP: https://github.com/roozbehp/persiancalendar |
| R&D | Tehran true noon at 51.42°E. This fails at 1469/1470 AP. |
| Wikipedia, Tøndering | "Tehran true time" |
| Borkowski | "Tehran mean time" |

Recommendation: compute at **52.5°E**, labelled.

**Months** (Afghan zodiac names are a locale variant):

| No. | Iran | Afghanistan | Days |
|---|---|---|---|
| 1 | Farvardin | Ḥamal | 31 |
| 2 | Ordibehesht | Sawr | 31 |
| 3 | Khordad | Jawzā | 31 |
| 4 | Tir | Saratān | 31 |
| 5 | Mordad | Asad | 31 |
| 6 | Shahrivar | Sunbula | 31 |
| 7 | Mehr | Mīzān | 30 |
| 8 | Aban | ʿAqrab | 30 |
| 9 | Azar | Qaws | 30 |
| 10 | Dey | Jadī | 30 |
| 11 | Bahman | Dalwa | 30 |
| 12 | Esfand | Ḥūt | 29 / 30 |

**Arithmetic approximations.**

| Scheme | Status |
|---|---|
| Birashk 2820-year cycle | **Wrong.** First failure: 20 Mar 2025, which should be 30 Esfand 1403. https://github.com/unicode-org/icu4x/issues/4713. Never use it. |
| 33-year rule: leap ⇔ y mod 33 ∈ {1, 5, 9, 13, 17, 22, 26, 30} | Matches every past and current year. Where it stops matching is contested: FarsiWeb says 2088 CE, ICU4X says 1501 AP (at 52.5°E), Borkowski says 1634 AP. |

Implementation: use the astronomical rule, via `Astronomy.Seasons(y).mar_equinox`
against 08:30 UTC. The 33-year rule is a cross-check only.

**Published vectors (Nowruz).** The authority's table is transcribed in ICU4X
`persian.rs`.

| Persian | Gregorian | Equinox | Source |
|---|---|---|---|
| 1 Farvardin 1402 | 21 Mar 2023 | 00:54:28 Tehran | https://7seen.com/index1402.htm; UT table |
| 1 Farvardin 1403 | 20 Mar 2024 | 06:36:26 Tehran | https://7seen.com/index1403.htm; UT table |
| 1 Farvardin 1404 | 21 Mar 2025 | 20 Mar, 09:01:30 UTC (after noon, so the next day) | Wikipedia "Nowruz"; ICU4X #4713 |
| 1 Farvardin 1405 | 21 Mar 2026 | 20 Mar, 14:45:59 UTC | Wikipedia "Nowruz" |
| 27 Esfand 1370 | 17 Mar 1992 | — | ICU4X persian `CASES` (R&D sample date) |

**Historical labels:**
- The 1975–78 imperial era (year 1354 jumped to 2535).
- Afghanistan's 1996–2001 lunar Hijri period.

**Verdict: SHIP.** Label the meridian.

### A4. Zoroastrian: Shahanshahi, Kadmi, Fasli and the 30 roz

**Structure.** All three variants use 12 months × 30 days, then 5 Gatha days
after month 12. The day names (roz) are the 30 yazatas of the **Sīh-rōzag**
litany, in the same order. **This fulfils the many-skies.md §2.4 "Sīh-rōzag"
row.**

| Variant | Rule | Navroz of year Y | Source |
|---|---|---|---|
| **Kadmi (Qadimi)** | Never intercalated | **JDN 1952063 + 365(Y−1)** (JDN 1952063 = 16 Jun 632, Yazdegerd III's accession) | https://en.wikipedia.org/wiki/Zoroastrian_calendar (citing Parise) |
| **Shahanshahi** | One 30-day month inserted once (between 1125 and 1129), never again | **JDN 1952093 + 365(Y−1)** | same; avesta.org: […], https://www.avesta.org/zcal.html |
| **Fasli** | Fasli Society proposal, 1906. Navroz fixed on 21 Mar; leap day *Avardad-sal-gah* after the Gathas, following Gregorian leap years | most recent 21 Mar; year = G − 630 | Wikipedia (citing Kadva's tables) |

**Algorithm (Kadmi and Shahanshahi):**
```
n = JDN − A        (A = 1952063 Kadmi, 1952093 Shahanshahi)
Y = floor(n/365) + 1;  d = n mod 365
if d < 360:  month = floor(d/30) + 1;  roz = (d mod 30) + 1
else:        Gatha day (d − 359)
```
Fasli works the same way from the most recent 21 March. d = 365 is
Avardad-sal-gah.

**The 12 months** (Parsi form, with Avestan):

| # | Month | Avestan |
|---|---|---|
| 1 | Farvardin | Fravašinąm |
| 2 | Ardibehesht | Ašahe Vahištahe |
| 3 | Khordad | Haurvatātō |
| 4 | Tir | Tištryehe |
| 5 | Amardad | Amərətātō |
| 6 | Shahrevar | Xšaθrahe Vairyehe |
| 7 | Meher | Miθrahe |
| 8 | Avan | Apąm |
| 9 | Adar | Āθrō |
| 10 | Dae | Daθušō |
| 11 | Bahman | Vaŋhə̄uš Manaŋhō |
| 12 | Spendarmad | Ārmatōiš |

**The 30 roz and their yazata.** Sources:
https://www.heritageinstitute.com/zoroastrianism/calendar/page2.htm, avesta.org,
Wikipedia.

| # | Roz | Yazata (Avestan) | # | Roz | Yazata (Avestan) |
|---|---|---|---|---|---|
| 1 | Hormazd | Ahura Mazda | 16 | Meher | Mithra |
| 2 | Bahman | Vohu Manah | 17 | Srosh | Sraosha |
| 3 | Ardibehesht | Asha Vahishta | 18 | Rashne | Rashnu |
| 4 | Shahrevar | Khshathra Vairya | 19 | Fravardin | Fravashi |
| 5 | Spendarmad | Spenta Armaiti | 20 | Behram | Verethraghna |
| 6 | Khordad | Haurvatat | 21 | Ram | Raman |
| 7 | Amardad | Ameretat | 22 | Govad | Vata |
| 8 | Dae-pa-Adar | Dadvah (creator) | 23 | Dae-pa-Din | Dadvah |
| 9 | Adar | Atar | 24 | Din | Daena |
| 10 | Avan | Apo | 25 | Ashishvangh | Ashi |
| 11 | Khorshed | Hvar Khshaeta | 26 | Ashtad | Arshtat |
| 12 | Mohor | Mah | 27 | Asman | Asman |
| 13 | Tir | Tishtrya | 28 | Zamyad | Zam |
| 14 | Gosh | Geush Urvan | 29 | Mareshpand | Manthra Spenta |
| 15 | Dae-pa-Meher | Dadvah | 30 | Aneran | Anaghra Raocha |

**The 5 Gatha days:** Ahunavad, Ushtavad, Spentomad, Vohukhshathra, Vahishtoisht.
A day whose roz equals its month name is a feast (*jashan*).

**Published vectors.** All of these fit the arithmetic above.

| Variant | Pair | Source |
|---|---|---|
| Shahanshahi | 15 Aug 2024 = Navroz 1394 | https://newsonair.gov.in/parsi-community-in-mumbai-celebrates-navroz-independence-day |
| Shahanshahi | 21 Aug 2000 = Navroz 1370 | Wikipedia |
| Shahanshahi | 1375: Farvardin 1 = 20 Aug 2005; Meher 1 = 16 Feb 2006 | https://www.moonwise.co.uk/year/1375zoroastrian.htm |
| Shahanshahi | Navroz Aug 17 (2016–19), Aug 16 (2020–21) | avesta.org |
| Kadmi | 16 Jul 2024 = New Year; 21 Jul 2024 = Khordad Sal (6 Farvardin) | https://www.prokerala.com/general/calendar/gujaraticalendar.php?month=7&year=2024&sb=1 |
| Kadmi | 22 Jul 2000 = Navroz 1370 | Wikipedia |
| Kadmi | 1375: Farvardin 1 = 21 Jul 2005 | Moonwise |
| Fasli | 21 Mar 2000 = 1 Farvardin 1370 | Wikipedia |
| Fasli | Leap year: Gathas 15–19 Mar, Avardad-sal-gah 20 Mar | Kadva tables, https://zoroastrian.ru/files/eng/zoroastrian-calendars-1379-ay-1400-ay-fasli.pdf |

**Contested conventions (label all):**
1. **Day boundary.** The day begins at **sunrise** (Bundahishn, per Wikipedia).
   A birth before dawn belongs to the previous roz. That edge is
   **NEEDS-LOCATION**; the civil-date reading is labelled.
2. **Fasli year count.** G − 630 (Wikipedia, avesta.org) versus G − 631 (one
   Heritage Institute page).
3. **Parsi Fasli versus Iranian Bastani.** Fasli is Gregorian-tied. Bastani
   follows the true equinox and the Solar Hijri calendar.
4. **Era label.** "AY (Yazdegerdi)". Wikipedia itself notes that "Y.Z." was
   coined on Wikipedia in 2006.
5. **Do not use holiday listings as vectors.** State holidays do not track the
   calendar; one list puts Shahanshahi Navroz on 16 Aug 2025, where the
   arithmetic gives 15 Aug.

**Verdict: SHIP**, as one Zoroastrian block. The roz and yazata are the
headline. Shahanshahi is the first line, labelled "majority Parsi reckoning".
Kadmi and Fasli follow as labelled variant lines (**NOTE-ON-PARENT**): same
names and structure, different epoch. All three are always shown, never one
silently picked.

### A5. Ethiopian and Coptic (the Alexandrian fixed year)

**Algorithm (R&D):**
```
fixed-from-coptic(y,m,d) = epoch − 1 + 365(y−1) + floor(y/4) + 30(m−1) + d
coptic-from-fixed(date): y = floor((4(date − epoch) + 1463)/1461);
  m = floor((date − fixed(y,1,1))/30) + 1;  d = date + 1 − fixed(y,m,1)
leap ⇔ y mod 4 = 3;   JDN = RD + 1721425
```
- Coptic epoch: **RD 103605** = 29 Aug 284 (Julian).
- Ethiopic epoch: **RD 2796** = 29 Aug 8 (Julian).
- The two calendars give an **identical month and day**. Only the year (276
  apart) and the names differ.

| # | Ethiopian | Coptic | Gregorian start (1900–2100) |
|---|---|---|---|
| 1 | Mäskäräm | Thout | 11 Sep (12 Sep before a Gregorian leap year) |
| 2 | Ṭəqəmt | Paopi | 11 Oct |
| 3 | Ḫədar | Hathor | 10 Nov |
| 4 | Taḫśaś | Koiak | 10 Dec |
| 5 | Ṭərr | Tobi | 9 Jan |
| 6 | Yäkatit | Meshir | 8 Feb |
| 7 | Mägabit | Paremhat | 10 Mar |
| 8 | Miyazya | Parmouti | 9 Apr |
| 9 | Gənbot | Pashons | 9 May |
| 10 | Säne | Paoni | 8 Jun |
| 11 | Ḥamle | Epip | 8 Jul |
| 12 | Nähase | Mesori | 7 Aug |
| 13 | Ṗagume (5 or 6 days) | Pi Kogi Enavot | 6 Sep |

**Published vectors:**

| Pair | Source |
|---|---|
| 1 Mäskäräm 2017 EC = 11 Sep 2024 | https://allafrica.com/stories/202409110253.html |
| 1 Mäskäräm 2016 EC = 12 Sep 2023 | https://www.ena.et/web/eng/w/en_38289; timeanddate |
| 1 Mäskäräm 2000 EC = 12 Sep 2007 | https://ethiopianembassy.org/ethiopian-time/ |
| 1 Thout 1592 AM = 11 Sep 1875 | Wikipedia, "Coptic calendar" |
| R&D sample: 1992-03-17 = Coptic 1708-07-08 = Ethiopic 1984-07-08 | pycalcal `dates1.tex` |
| R&D sample: 2038-11-10 = Coptic 1755-03-01 = Ethiopic 2031-03-01 | same |

**Labels:**
- The Amete Alem era (= Amete Mihret + 5500).
- The Ethiopian clock counts hours from dawn (6 am = "12:00"). This is a display
  convention; the date still turns at midnight.

**Do not use Christmas as a vector.** Genna […] is a feast
rule. In years after 12 September starts, the arithmetic gives 28 Taḫśaś.

**Verdicts.**
- Ethiopian: **SHIP**. It is the national civil calendar of Ethiopia.
- Coptic: **NOTE-ON-PARENT**. Same day and month; its own names and the AM year
  appear as a line.

### A6. Arabic lunar mansions (manāzil al-qamar)

**Two forms.**

1. **Anwāʾ** (pre-Islamic).
   - Dawn risings and settings of star groups, tied to rain. Unequal and
     latitude-dependent.
   - Varisco, […], *Studia Islamica* 74
     (1991). Kunitzsch, "al-Manāzil", *EI²* vi 374–376: the 28-mansion scheme
     came from India […].
   - **NOTE-ON-PARENT** (history line). Not computed.
2. **The equal astrological form.**
   - 28 × 12°51′25.7″ (= 360/28), **from 0° Aries tropical**.
   - Picatrix (Arabic *Ghāyat al-Ḥakīm*): the first mansion […].
   - Al-Bīrūnī, *Tafhīm* (1029), §164: […] https://www.skyscript.co.uk/albiruni_elements.html
   - Conflict to label: Wikipedia "Lunar station" titles its start column
     "sidereal". The medieval sources say equinoctial. A sidereal variant is a
     NOTE.

**A copy of the nakshatras? No.** This **reverses many-skies.md §2.4**.

| | Manāzil | Nakshatras |
|---|---|---|
| Count | 28 | 27 |
| Width | 12.857° | 13.333° |
| Origin | tropical equinox | Lahiri sidereal (~24° apart today) |
| Names and marker stars | Arabic | Indian |

Shared ancestry is a provenance note, not a duplicate partition.

**Boundary table.** Start = (k−1)·360/28, tropical. Marker stars per Wikipedia
"Lunar station".

| # | Mansion | Marker stars | Start |
|---|---|---|---|
| 1 | al-Sharaṭān | α β Ari | 0°00′00″ Ari |
| 2 | al-Buṭayn | 35, 39, 41 Ari | 12°51′26″ Ari |
| 3 | al-Thurayyā | Pleiades | 25°42′51″ Ari |
| 4 | al-Dabarān | Aldebaran | 8°34′17″ Tau |
| 5 | al-Haqʿa | λ φ Ori | 21°25′43″ Tau |
| 6 | al-Hanʿa | γ ξ Gem | 4°17′09″ Gem |
| 7 | al-Dhirāʿ | Castor, Pollux | 17°08′34″ Gem |
| 8 | al-Nathra | M44 | 0°00′00″ Cnc |
| 9 | al-Ṭarf | κ Cnc, λ Leo | 12°51′26″ Cnc |
| 10 | al-Jabha | Regulus | 25°42′51″ Cnc |
| 11 | al-Zubra | δ θ Leo | 8°34′17″ Leo |
| 12 | al-Ṣarfa | Denebola | 21°25′43″ Leo |
| 13 | al-ʿAwwāʾ | β η γ δ ε Vir | 4°17′09″ Vir |
| 14 | al-Simāk | Spica | 17°08′34″ Vir |
| 15 | al-Ghafr | ι κ λ Vir | 0°00′00″ Lib |
| 16 | al-Zubānā | α β Lib | 12°51′26″ Lib |
| 17 | al-Iklīl | β δ π Sco | 25°42′51″ Lib |
| 18 | al-Qalb | Antares | 8°34′17″ Sco |
| 19 | al-Shawla | λ υ Sco | 21°25′43″ Sco |
| 20 | al-Naʿāʾim | γ δ ε … Sgr | 4°17′09″ Sgr |
| 21 | al-Balda | (empty patch) | 17°08′34″ Sgr |
| 22 | Saʿd al-Dhābiḥ | α β Cap | 0°00′00″ Cap |
| 23 | Saʿd Bulaʿ | ε μ Aqr | 12°51′26″ Cap |
| 24 | Saʿd al-Suʿūd | β ξ Aqr | 25°42′51″ Cap |
| 25 | Saʿd al-Akhbiya | γ π ζ η Aqr | 8°34′17″ Aqr |
| 26 | al-Fargh al-Muqaddam | α β Peg | 21°25′43″ Aqr |
| 27 | al-Fargh al-Muʾakhkhar | γ Peg, α And | 4°17′09″ Psc |
| 28 | Baṭn al-Ḥūt (al-Rishāʾ) | β And | 17°08′34″ Psc |

**Published vectors:**
- Wikipedia's starts (rounded): 0°0′, 12°51′, 25°43′, 8°34′ … Mansions 8, 15 and
  22 begin at 0° Cancer, Libra and Capricorn.
- Picatrix (Thomas translation): mansion 1 runs 0° to 12°51′26″ Aries.
- **Warning:** the renaissanceastrology.com Picatrix table has copying errors
  (e.g. mansion 2 ends "21°42′12″"). Use exact k·360/28.
- **Open:** no dated […] vector found. Christopher Warnock's
  mansion ephemeris for 2019–2033 is the place to extract one.

**Verdict: SHIP-LABELLED.** `floor(λ☾ / (360/28))`, tropical, labelled
"medieval equal form". The sidereal variant is a NOTE; the anwāʾ is a history
NOTE.

### A7. Egyptian civil calendar (the wandering year)

**What it is.** A 365-day year with no leap day:
- 3 seasons (Akhet, Peret, Shemu) × 4 months × 30 days;
- then 5 epagomenal days, the birthdays of Osiris, Horus, Set, Isis and
  Nephthys.

Augustus's reform (26/25 BCE) fixed it into the Alexandrian year, which is the
Coptic calendar (A5).

**Algorithm (R&D):**
```
epoch = JD 1448638 = RD −272787 = 26 Feb 747 BCE (Julian)   (Ptolemy's Nabonassar era)
days = date − epoch;  y = floor(days/365) + 1
m = floor((days mod 365)/30) + 1;  d = (days mod 365) mod 30 + 1   (m = 13 → epagomenal)
```
Almagest, via https://en.wikipedia.org/wiki/Nabonassar: […].

| Season-month | Greek | Coptic |
|---|---|---|
| I Akhet | Thoth | Thout |
| II Akhet | Phaophi | Paopi |
| III Akhet | Athyr | Hathor |
| IV Akhet | Choiak | Koiak |
| I Peret | Tybi | Tobi |
| II Peret | Mechir | Meshir |
| III Peret | Phamenoth | Paremhat |
| IV Peret | Pharmuthi | Parmouti |
| I Shemu | Pachon | Pashons |
| II Shemu | Payni | Paoni |
| III Shemu | Epiphi | Epip |
| IV Shemu | Mesore | Mesori |
| *Ḥryw Rnpt* ([…]) | epagomenai | Pi Kogi Enavot |

**Published vectors:**

| Pair | Source |
|---|---|
| 1 Thoth 1 Nabonassar = 26 Feb 747 BCE (Julian) | R&D; Almagest |
| 1992-03-17 = 2740 / XI (Epiphi) / 27 | R&D Appendix C (pycalcal) |
| 2038-11-10 = 2787-08-01; 1996-02-25 = 2744-11-07 | same |
| 18 Jul AD 1 (Julian) = III Shemu 30; 20 Jul AD 500 = IV Akhet 2 | Wikipedia Sothic table (van Gent) |

**Contested points:**
- **The Sothic anchor** (Censorinus, 139 CE: 20 or 21 July). Disputed; never
  used as an anchor.
- **The year number.** The Nabonassar era is Hellenistic astronomers' count,
  not an Egyptian civil count (Egyptians used regnal years).
- **The modern date.** It is a proleptic continuation of a dead calendar's day
  count. The count itself runs unbroken through every anchor.

**Verdict: SHIP-LABELLED**, `ancient-reconstructed`. Label it […]. Show the season-month, the Greek
name and the god-birthday on epagomenal days.

**Engine note.** This **wandering-year kernel** (365, 12 × 30 + 5) is shared
with Kadmi/Shahanshahi (A4), Armenian and Mandaean (§C). One pure function
`wanderingYear(jdn, epochJdn)` serves them all.

### A8. Babylonian / Mesopotamian

**Lunisolar calendar.**
- Each month began at sunset with the first crescent.
- 19-year intercalation from about 499 BCE, without exception by 380 BCE.
- Months: Nīsannu, Ayyāru, Sīmannu, Duʾūzu, Ābu, Ulūlu, Tašrītu, Araḫsamna,
  Kislīmu, Ṭebētu, Šabāṭu, Addāru, plus Addāru II or Ulūlu II.
  https://webspace.science.uu.nl/~gent0113/babylon/babycal_months.htm
- R&D 4th ed. defines a mechanical reconstruction:
  - epoch: Seleucid era, 3 Apr 311 BCE;
  - leap ⇔ `(7y+13) mod 19 < 7`;
  - location: Babylon, 32.4794°N 44.4328°E;
  - new month when the phase is between new moon and first quarter, the new moon
    was ≥ 24 h earlier, **and moonset − sunset > 48 min**.
- Parker & Dubberstein's tables stop at 75/76 CE.

**Verdict: DO-NOT-SHIP.**
- It is a dead calendar with no attested dates after 75 CE.
- A modern "Babylonian date" would be a modern visibility model run at Babylon.
  That is our invention, not the tradition.
- Its month names and 19-year cycle live on in the Hebrew calendar (A1). A
  heritage note belongs there.

**Babylonian sidereal zodiac.**
- MUL.APIN dates to about 1000 BCE. Britton 2010 is the study of the uniform
  zodiac (*AHES* 64:617–663).
- Swiss Ephemeris §2.8.2 (https://www.astro.com/swisseph/swisseph.htm):
  - Fagan-Bradley ayanamsa = 24°02′31.36″ at 1950.0;
  - Huber's zodiac differs from it by under 1′;
  - Britton's differs by about 7′.
- **Verdict: NOTE-ON-PARENT.** An alternative ayanamsa line under Jyotisha,
  labelled and contested. Never a substitute for Lahiri.

### A9. African day and market cycles

**Igbo izu (4-day market week).** Source: https://en.wikipedia.org/wiki/Igbo_calendar
(citing Onwuejeogwu 1981). Eke, Orie (Oye), Afọ (Afor), Nkwọ. 7 izu = a 28-day
month; 13 months + 1 day = a year.

| JDN mod 4 | 1 | 2 | 3 | 0 |
|---|---|---|---|---|
| Market day | Eke | Orie | Afọ | Nkwọ |

**Published vectors.** Three communities and three apps; every one fits the
rule above.

| Date | Published | Source |
|---|---|---|
| 2024-09-17 / 22 | Afor / Nkwo (Nzukoro) | Arochukwu Kingdom approved Ikeji calendar 2024, https://arochukwublog.com/ikeji-arochukwu-kingdom-approved-calendar-2024/ (all 17 entries fit) |
| 2024-10-01 | Eke | same |
| 2026-01-01 | Orie | https://afrotools.com/blog/igbo-market-days/ |
| 2026-10-01 / 17 / 22 | Afor / AFOR / NKWO | Ofala Onitsha ceremonial cycle, https://ofala.org/ceremonial-cycle/ (all 35 entries fit) |
| 2026-10-19 | Eke | https://marketdays.ng/igbo-market-calendar/; Ofala |
| 2026-12-25 | Nkwo | AfroTools |

Wikipedia says the calendar is […] across groups.
The sources found agree anyway.

**Verdicts.**
- Market day: **SHIP-LABELLED**, labelled […].
- Izu ukwu (8-day great/small phase): **DO-NOT-SHIP**. No published anchor for
  which Eke is the "great" one; Vanguard 2025 says veneration […].
- Igbo month and year: **DO-NOT-SHIP**. Nri starts about mid-February; the Aro
  year ends at Ikeji in September.

**Yoruba Ọ̀sẹ̀ (4-day week).** Days: Ọbàtálá (Ọ̀sẹ̀), Ọ̀rúnmìlà/Ifá (Awo), Ògún,
Ṣàngó (Jàkúta).
- Wikipedia (citing Gyllenbok 2018) and ooduarere give this order.
- Kominifa starts the week at Ifá: same cyclic order, different start.
- Ileifa: […].
- **The published anchors conflict.** Ifabilawo's 2026 Ifá days fall at JDN
  mod 4 = 2; a 2011 sample table puts them at mod 4 = 0. Some versions also reset
  each 364-day year.
- **Verdict: DO-NOT-SHIP** until a single published anchor holds.

**Yoruba Kọ́jọ́dá year number.**
- The year starts on 3 June; year = Gregorian year + 8042 from that date.
- Agreeing sources: 2014 = 10056 (yorubaness); 2026 = 10068 (Wikipedia;
  ooduarere 2026-06-03); 1958 = 10000.
- It is a modern epoch convention attributed to Remi-Niyi Alaran (the year of
  the proposal is unverified). Month names follow the Gregorian months.
- **Verdict: SHIP-LABELLED in the civil-locked class (§C.0).**

**Akan adaduanan (42-day cycle).**
- The six nnanson days Fo, Nwuna, Nkyi, Kuru, Kwa, Mono, crossed with the
  7-day week, give 42 named days (Fo-Dwo, Nwuna-Bena, …).
- The sacred days (dabɔne) fall 9 days apart: Fɔdwo, Awukudae, Fofie,
  Akwasidae.
- Sources: https://en.wikipedia.org/wiki/Akan_calendar; Kwahu/Bono lists.

```
nnanson = [Fo, Nwuna, Nkyi, Kuru, Kwa, Mono][(JDN − 2) mod 6]
cycle index i = (JDN − 14) mod 42        (0 = Fɔdwo)
Fɔdwo ≡ 14 · Awukudae ≡ 23 · Fofie ≡ 32 · Akwasidae (Kuru-Kwasi) ≡ 41   (JDN mod 42)
```

**Published Akwasidae dates.** Every date is ≡ 41 and 42 days from the next; the
rule holds over 47 years.

| Year | Dates | Source |
|---|---|---|
| 2025 | Jan 19, Mar 2, Apr 13, May 25, Jul 6, Aug 17, Sep 28, Nov 9, Dec 21 | https://www.nyamedua.org/2024/03/30/akwasidae-dates-2025/; https://www.akandictionary.com/2024/04/02/akwasidae-dates-2025/ |
| 2026 | Feb 1, Mar 15, Apr 26, Jun 7, Jul 19, Aug 30, Oct 11, Nov 22 | https://www.nyamedua.org/2025/07/19/akwasidae-dates-2026/; https://visitghana.com/event/akwasidae-festival/; Manhyia Palace on X (Jul 19) |
| 1978 | Jan 8, Feb 19, May 14, Jun 25, Aug 6, Sep 17, Oct 29, Dec 10 | Wikipedia. Its "2 March" and "30 July" are typos. |

The palace may move a *celebration*, but the cycle itself is fixed.

**Verdict: SHIP**, inside the existing Akan block beside kra din. It adds the
nnanson day, the 42-day name and the sacred-day flag.

### A10. Mesoamerican extras

**Aztec xiuhpohualli.** 18 veintenas × 20 days + 5 nemontemi. Veintenas:
Ātlcāhualo, Tlācaxīpēhualiztli, Tōzōztōntli, Huēyi Tōzōztli, Toxcatl,
Etzalcualiztli, Tēcuilhuitōntli, Huēyi Tēcuilhuitl, Tlaxōchimaco, Xocotl Huetzi,
Ochpaniztli, Teōtlehco, Tepēilhuitl, Quechōlli, Panquetzaliztli, Ātemoztli,
Tititl, Izcalli.

The correlation is **contested**: at least five are published.

| Correlation | Rule |
|---|---|
| Caso (1967) / Caso–Nicholson | Vague year, no leap day. 13 Aug 1521 (Julian) = 1 Coatl, 2 Xocotl Huetzi, year 3 Calli. azteccalendar.com uses this, with **Izcalli as the first veintena**. |
| Tena (INAH) | Leap-corrected; the year starts 13 Feb Julian / 23 Feb Gregorian. |
| Sahagún | Atlcahualo begins 2 Feb Julian. |
| Durán | Atlcahualo begins 1 Mar. |
| Ochoa, Meza | Variable nemontemi (practitioner models). |

Published vectors (likely a single algorithm, one source):
- 13 Aug 1521 = 1 Coatl / 2 Xocotl Huetzi / 3 Calli
  (https://www.azteccalendar.com/?day=13&month=8&year=1521&datesys=julian);
- 18 Oct 2026 = 16 Izcalli (azteccalendar.com; Wikipedia's infobox).

**Verdict: SHIP-LABELLED, HELD.** Name the correlation ([…]) and print Tena as the alternative. Held until a **third,
independent** published vector confirms the modern-date continuation. The
tonalpohualli day-sign is uncontested and already shown.

**Maya 819-day count.**
- 819 = 7 × 9 × 13. Discovered by Thompson (1943).
- Berlin & Kelley (1961): each station carries a colour and direction (red east,
  white north, black west, yellow south) and is tied to K'awiil.
- The full colour cycle is 3276 days.

```
m = JDN − 584283        (the GMT correlation already shipped)
offset = (m + 3) mod 819;   station = m − offset
base station 12.19.19.17.17, 1 Kaban 5 Kumk'u (east), 3 days before the era base
direction cycles East → South → West → North (Lounsbury)
```

| Station | Site | Source |
|---|---|---|
| 12.19.19.17.17 1 Kaban 5 Kumk'u | base station, east | https://mayadecipherment.com/2012/06/11/xultun-number-a-and-the-819-day-count/; mayan-calendar.com |
| 12.9.19.14.5 1 Chikchan 18 Ch'en | Palenque Temple XIX | mayadecipherment.com |
| 12.19.13.3.0 1 Ajaw 18 Sotz' | Palenque Temple of the Cross | Lounsbury, *DSB*: https://www.encyclopedia.com/science/dictionaries-thesauruses-pictures-and-press-releases/maya-numeration-computation-and-calendrical-astronomy |

All three satisfy (m + 3) mod 819 = 0 (checked).
- **Label:** Lounsbury calls the station order "clockwise"; Hopkins calls the
  underlying scheme "counter-clockwise"
  (https://www.famsi.org/research/hopkins/DirectionalPartitions.pdf).
- **Omit or label as hypothesis:** Linden & Bricker 2023's 20 × 819 planetary
  super-cycle (*Ancient Mesoamerica* 34:690–700).

**Verdict: SHIP-LABELLED**, inside the Maya block. Emit the days since the last
station, its direction and colour, and the station's Tzolk'in. It inherits the
GMT label.

### A11. Celtic, Norse, Slavic

**The Graves tree calendar** (Robert Graves, *The White Goddess*, 1948).
- Mary Jones: […]. https://www.maryjones.us/jce/celtictreecalendar.html
- Graves's own text fixes only that the first month starts right after the
  winter solstice, and the extra day "about Christmas Eve". **The exact date
  ranges below are the later popular table.** We could not confirm Graves
  printed them.

| Month | Dates | Month | Dates |
|---|---|---|---|
| Beth (Birch) | Dec 24 – Jan 20 | Tinne (Holly) | Jul 8 – Aug 4 |
| Luis (Rowan) | Jan 21 – Feb 17 | Coll (Hazel) | Aug 5 – Sep 1 |
| Nion (Ash) | Feb 18 – Mar 17 | Muin (Vine) | Sep 2 – Sep 29 |
| Fearn (Alder) | Mar 18 – Apr 14 | Gort (Ivy) | Sep 30 – Oct 27 |
| Saille (Willow) | Apr 15 – May 12 | Ngetal (Reed) | Oct 28 – Nov 24 |
| Uath (Hawthorn) | May 13 – Jun 9 | Ruis (Elder) | Nov 25 – Dec 22 |
| Duir (Oak) | Jun 10 – Jul 7 | (nameless day) | Dec 23 |

- **Discrepancy:** some lists run Reed to Nov 23 and Elder Nov 24 – Dec 23, with
  no nameless day.
- **Verdict:** objective (a fixed table) and not a copy (a different partition
  from the zodiac). **SHIP-LABELLED in the civil-locked class (§C.0)**, labelled
  […].

**"Celtic/Gaulish tree horoscope"** (21 trees, 40 date ranges). Invented by Paula
Delsol for *Marie Claire* (1971). A German Federal Court case (I ZR 7/90, 1991)
traced it to a Polish gardening calendar via a translation error.
https://de.wikipedia.org/wiki/Keltisches_Baumhoroskop

**Verdict: DO-NOT-SHIP.**
- We did not verify its date table.
- Its only claimed meaning rests on a false Celtic attribution.
- It is rule-eligible in principle as "modern, 1971". Revisit only on the
  owner's word and with a verified table.

**Old Icelandic calendar (misseri).** Source: Svante Janson, "The Icelandic
Calendar", https://www2.math.uu.se/~svantejs/papers/calendars/iceland.pdf
- 52 weeks (364 days), or 53 with the summer week *sumarauki*.
- 12 × 30 days + 4 extra nights (aukanætur), placed between S3 and S4.
- Tied to the Gregorian calendar since 1700.
- `ancient-living`: the First Day of Summer is still a public holiday.

| # | Month | Starts on | Range | # | Month | Starts on | Range |
|---|---|---|---|---|---|---|---|
| S1 | Harpa | Thu | Apr 19–25 | W1 | Gormánuður | Sat | Oct 21–28 |
| S2 | Skerpla | Sat | May 19–25 | W2 | Ýlir | Mon | Nov 20–27 |
| S3 | Sólmánuður | Mon | Jun 18–24 | W3 | Mörsugur | Wed | Dec 20–27 |
| S4 | Heyannir | Sun | Jul 23–30 | W4 | Þorri | Fri | Jan 19–26 |
| S5 | Tvímánuður | Tue | Aug 22–29 | W5 | Góa | Sun | Feb 18–25 |
| S6 | Haustmánuður | Thu | Sep 21–28 | W6 | Einmánuður | Tue | Mar 20–26 |

**Rule (Janson §3):**
- FDS(Y) = the Thursday in 19–25 April.
- S1–S3 count forward from FDS(Y) in 30-day steps.
- S4–W6 count backward from FDS(Y+1). W1 = FDS(Y+1) − 180.
- Sumarauki falls when FDS = 19 Apr, or FDS = 20 Apr and the next year is a
  Gregorian leap year (*rímspillir*).

**Published vectors:**
- First Day of Summer: 2023-04-20, 2024-04-25, 2025-04-24, 2026-04-23
  (https://www.timeanddate.com/holidays/iceland/first-day-summer).
- Þorri begins 2024-01-26 (the rímspillir case) and 2025-01-24
  (http://www.almanak.hi.is/dagsetn.html).

**Verdict: SHIP.** Label the pre-1837 Friday start of winter and Janson's
aukanætur remarks.

**Swedish runic calendar (runstav)** and **Norwegian primstav.**
- The runstav writes the Julian computus in runes: 19 golden-number runes
  (including árlaug, tvímaðr, belgþórr) and 7 Sunday-letter runes.
  https://en.wikipedia.org/wiki/Runic_calendar
- The primstav is a perpetual Julian feast-day stick: summer side from 14 Apr,
  winter side from 14 Oct. https://snl.no/primstav
- **Verdict: NOTE-ON-PARENT** (golden number = (Y mod 19) + 1, Julian date).

**Coligny calendar** (Gaulish bronze, late 2nd century CE).
- 5-year cycle, 62 months: Samonios, Dumannios, Riuros, Anagantios, Ogronnios,
  Cutios, Giamonios, Simivisonnios, Equos, Elembivios, Edrinios, Cantlos, plus
  intercalary months. https://en.wikipedia.org/wiki/Coligny_calendar
- The reconstructions disagree on the cycle (Olmsted's 30-year cycle with a
  dropped month, McKay's Metonic cycle), the year start (autumn, solstice, May,
  March) and the month start (new or full moon).
- Converters admit to an arbitrary epoch […]
  (https://time-meddler.co.uk/the-coligny-calendar/).
- **Verdict: DO-NOT-SHIP.**

**Slavic.** No objective pre-Christian calendar survives.
- "Kolyada Dar" and Chislobog come from Ynglism (Khinevich, 1990s):
  https://en.wikipedia.org/wiki/Ynglism
- The animal-sign "Slavic horoscope" is late 20th century:
  https://seecheck.org/index.php/2025/12/04/the-popular-ancient-slavic-horoscope-is-actually-a-modern-invention/
- **Verdict: DO-NOT-SHIP** (fabrication).

---

## B. Modern systems under the rule

### B1. Human Design: 64-gate wheel, lines and the design chart

**Provenance:** `modern` — Alan R. Krakower ("Ra Uru Hu"). He dates his claimed
revelation to 1987; *The Human Design System* was published in 1992.

**The wheel**, verified from three sources:
1. barneyandflow.com, a gate/degree table: https://www.barneyandflow.com/gate-zodiac-degrees
2. bonniesorsby.com: https://bonniesorsby.com/human-design-gates-by-degree/
3. **MIT code**: `CReizner/SharpAstrology.HumanDesign`, `Enums/Gates.cs` and
   `Utility/HumanDesignUtility.cs` (`HdOffsetToZodiac = 3.875`,
   `DegreePerGate = 5.625`, `DegreePerLine = 0.9375`).
   https://github.com/CReizner/SharpAstrology.HumanDesign

**Anchor:** Gate 41 starts at **302° (2°00′ Aquarius) tropical**. The two
anchors agree: 302 + 11 × 5.625 ≡ 3.875.

```
ORDER (increasing longitude from 302°):
41 19 13 49 30 55 37 63 22 36 25 17 21 51 42  3 27 24  2 23  8 20 16 35 45 12 15 52 39 53 62 56
31 33  7  4 29 59 40 64 47  6 46 18 48 57 32 50 28 44  1 43 14 34  9  5 26 11 10 58 38 54 61 60
x    = (λ − 302) mod 360
gate = ORDER[floor(x / 5.625)]          // 5°37′30″ per gate
line = floor((x mod 5.625) / 0.9375) + 1 // 0°56′15″ per line, 1..6
```

The order is not King Wen; it is a new arrangement of the 64 hexagrams laid on
the tropical zodiac. Typo to avoid: barneyandflow prints gate 45's end as
"22°27′30″ Gemini". The correct value is 22°37′30″.

**The design chart** is the instant when the Sun stood **88° of solar arc**
earlier (not 88 days; that is about 87–92 days). Sources:
https://www.gethumandesign.com/docs/foundations/how-a-chart-is-calculated/;
SharpAstrology `DesignDegDistance = 88` (root-found).

Implementation: `Astronomy.SearchSunLongitude((λ☉ − 88) mod 360, birth − ~95 d, ~10 d)`.

**Activations:** Sun, Earth (Sun + 180°), lunar nodes, Moon, Mercury–Pluto, in
both charts.

**Published vector** (SharpAstrology README, Swiss Ephemeris Moshier mode):
- Input: 2024-01-01 00:00 UTC.
- Output: Generator, profile **1/3**, Emotional authority, […], channels 29-46 and 39-55.
- No vector published by Jovian Archive was found. Before shipping, extract two
  or three more published chart vectors.

**Precision:** ±1′ is enough for gate and line (line width 56′15″). **Do not
ship colour, tone or base** (sub-arcminute claims; many-skies.md §2.5).

**Open:** true or mean node. Calculators differ, so label it.

**Legal:**
- Tribunale di Firenze, order 944/2020 (3 Jun 2020): no copyright in the
  *system*. Interim, and binding in Italy only.
- Trademarks: US […] (serial 97639098); "Rave
  BodyGraph™" and "Rave Mandala™".
- Name the output neutrally ([…]). Write
  our own gate texts.

**Verdict: SHIP-LABELLED.** Objective (from longitudes) and not a copy. This
unblocks the `gates64` deferral in `core/cosmos/skies/index.js`.

### B2. Gene Keys (Richard Rudd, 2009)

- Same wheel, same lines, same 88° design point. The "Hologenetic Profile" is a
  relabelling: Life's Work = Personality Sun, Evolution = Personality Earth,
  Radiance = Design Sun, Purpose = Design Earth.
- One source swaps Evolution and Radiance.
- https://genekeys.com/resources/; https://www.kellyharringtonrd.com/post/gene-keys-human-design-gates

**Verdict: NOTE-ON-PARENT** (B1).

### B3. Numerology life path (L. Dow Balliett, 1905/1908)

- The "Pythagorean" label is modern (https://yronwode.org/numerology-bibliography.html).
- **The methods diverge on published values.** For 27 Mar 1988:
  - component-first reduction gives **2** (https://www.thehoroscope.co/…,
    https://www.ask-oracle.com/birthday/1988/03/27/);
  - all-digits reduction gives **11** (https://birthdaydetails.com/march-27-1988-zodiac-facts-events-holidays/).
- Master-number retention also varies (11/22; 33 is a later addition).
- The input is the decimal rendering of a Gregorian date in one timezone. It is
  not the instant, not the sky, not a calendar's own structure.

**Verdict: DO-NOT-SHIP.** There is no single fixed method, so there is no
objective ground. This confirms many-skies.md §2.4.

### B4. Sabian symbols (Marc Edmund Jones & Elsie Wheeler, 1925)

- Book 1953; Rudhyar's rewording 1973.
- **Copyright:** Jones died in 1980, and the 1953 renewal status is unverified.
  Ship **no** Jones or Rudhyar wording. The ratified decision stands: we write
  our own 360 texts.
- **Index convention: round up.** Lynda Hill: […]. RASA: […]. Khaldea: 23°01′ and 23°59′ Leo are both "24 Leo".
- **Contested edge:** Bovee puts an exact whole degree into the next symbol
  (0°00′ → 1).
- Index = `ceil(λ_in_sign)`, with exact 0 mapped to 1; the exact-integer edge is
  labelled.

**Verdict: SHIP** the 1–360 index per body, with our texts once written.

### B5. 13-Moon calendar (José & Lloydine Argüelles, 1987–92)

From https://www.lawoftime.org/thirteenmoon/basics.html:

| Moon | Dates |
|---|---|
| Magnetic | Jul 26–Aug 22 |
| Lunar | Aug 23–Sep 19 |
| Electric | Sep 20–Oct 17 |
| Self-Existing | Oct 18–Nov 14 |
| Overtone | Nov 15–Dec 12 |
| Rhythmic | Dec 13–Jan 9 |
| Resonant | Jan 10–Feb 6 |
| Galactic | Feb 7–Mar 6 |
| Solar | Mar 7–Apr 3 |
| Planetary | Apr 4–May 1 |
| Spectral | May 2–29 |
| Crystal | May 30–Jun 26 |
| Cosmic | Jun 27–Jul 24 |
| Day Out of Time | Jul 25 |

- 29 February is "0.0 Hunab Ku".
- **Feb 29 births** (https://lawoftime.org/decode/): […]. This is a local-clock rule, already noted
  in many-skies.md §2.1; label it.

**Verdict: NOTE-ON-PARENT** (Dreamspell).

### B6. Uranian / Hamburg School and Cosmobiology

- Witte's *Regelwerk* (1928): midpoints. Ebertin, *Kombination der
  Gestirneinflüsse* (1940), kept the midpoints and the 90° dial and dropped the
  hypothetical points. https://en.wikipedia.org/wiki/Hamburg_School_of_Astrology
- The hypothetical planets (Cupido, Hades, Zeus, Kronos by Witte; Apollon,
  Admetos, Vulkanus, Poseidon by Sieggrün, 1927) have published "elements" but
  **do not exist**.

**Verdicts.**
- Midpoints and dial: **NOTE-ON-PARENT**. A derived view of the Western chart:
  arithmetic on what is already shown, computed on demand. Midpoints that use
  ASC or MC need location.
- Hypothetical planets: **DO-NOT-SHIP**. Showing invented bodies as positions
  would be fabrication.

### B7. Heliocentric positions

Objective, via `HelioVector`. It is the same bodies seen from another vantage.

**Verdict: NOTE-ON-PARENT** (an optional Western-chart view).

### B8. Lunar nodes, Black Moon Lilith, asteroids

**Mean node.** Meeus ch. 47:
```
Ω = 125.0445479 − 1934.1362891T + 0.0020754T² + T³/467441 − T⁴/60616000
```
T = Julian centuries (TT) from J2000. Confirmed verbatim in
https://github.com/soniakeys/meeus/blob/master/v3/moon/moon.go. The true node is
osculating (Swiss Ephemeris §2.2.2).

**Mean apogee** ("Black Moon Lilith") = mean perigee + 180°. Mean perigee =
83.3532465 + 4069.0137287T + … (higher terms to verify). The "true" (osculating)
Lilith swings about ±30°; label it or skip it.

**Verdicts.**
- Mean node and mean apogee: **SHIP-LABELLED** as Western-chart additions. The
  natal chart has no nodes today, and B1 needs them. Label mean versus true.
- Chiron, Ceres, Pallas, Juno, Vesta: **DO-NOT-SHIP now**. astronomy-engine has
  no such bodies, and the options all mean a new dependency or data layer:
  - Swiss Ephemeris: AGPL or a paid licence, rejected in many-skies.md §2.5;
  - JPL/MPC orbital elements integrated with astronomy-engine's
    `GravitySimulator`: possible later, but accuracy must be proven;
  - precomputed JPL Horizons tables.

### B9. Other reproducible modern and ancient derived systems

| System | Author / year | Method | Verdict |
|---|---|---|---|
| Lunar phase at birth | astronomical; 8-family naming per Rudhyar, *The Lunation Cycle* (1967) | Moon − Sun elongation | **SHIP-LABELLED**. The 8 × 45° bounds are **unverified**; label the convention. |
| Prenatal syzygy | Ptolemy, *Tetrabiblos* III.2 (https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Ptolemy/Tetrabiblos/3A*.html) | Last new or full moon before birth (`SearchMoonPhase` backwards); instant and both longitudes | **SHIP-LABELLED**. Choosing the […] at a full moon is NEEDS-LOCATION. |
| Fixed-star conjunctions, Galactic Center | catalogue-based; Sgr A* J2000 per Reid & Brunthaler 2004 | Catalogue + precession + orb | **SHIP-LABELLED, phase 2**. Catalogue, orb and epoch are named conventions. `DefineStar` holds only 8 stars; precess by hand beyond that. |
| Harmonic charts | John Addey, *Harmonics in Astrology* (Wikipedia: 1975) | λ·H mod 360 | **NOTE-ON-PARENT** |
| Draconic chart | author unverified | λ − node | **NOTE-ON-PARENT** |
| Solar return | traditional | Instant when λ☉ returns | **NOTE-ON-PARENT** (instant only; houses need location) |
| Lots / Arabic Parts, profections | Hellenistic | ASC-based | **NEEDS-LOCATION** (already deferred) |
| Tertiary progressions | modern | Forecasting | **DO-NOT-SHIP** (not a reading of the birth instant) |

---

## C. The world sweep

### C.0 A class decision: civil-locked calendars

Several objective systems are **fixed tables over the Gregorian day**. They have
named months or bins, but no astronomy and no independent count. One decision
should govern them as a class, not each separately:

| Member | Rule | Provenance |
|---|---|---|
| Indian National Calendar (Saka) | 1 Chaitra = 22 Mar (21 in a Gregorian leap year); Vaiśākha–Bhādra have 31 days; Saka year = CE − 78. Vectors: 22 Mar 1957 = 1 Chaitra 1879; 22 Mar 2025 = 1 Chaitra 1947 (https://en.wikipedia.org/wiki/Indian_national_calendar). | modern-1957 (Calendar Reform Committee) |
| Bangladesh Bangabda | 1 Boishakh = 14 Apr; Boishakh–Ashwin have 31 days; Falgun 29/30 following the Gregorian leap year. Vector: 1426 BS = 14 Apr 2019 – 13 Apr 2020 (https://en.wikipedia.org/wiki/Bangladeshi_national_calendar). | modern-1987, revised 2019. The pre-2019 rule applies to older births. |
| Mool Nanakshahi | Fixed tropical dates (Vaisakhi = 14 Apr) | modern-2003 (Purewal). **Contested**: the SGPC reverted to Bikrami reckoning (Tribune, Oct 2026). |
| Graves tree calendar | §A11 | modern-1948 |
| Yoruba Kọ́jọ́dá year | §A9 | modern (Alaran) |

**Recommendation:** SHIP-LABELLED as one compact "civil-locked" group, each item
carrying its author or body and year. The alternative is to drop the whole group
as relabelings of the civil date.

**Owner's call.** Pure era offsets with no new structure (Thai BE = CE + 543) are
NOTE either way.

### C.1 Ship candidates

**24 solar terms + 72 pentads** (節氣 / 候). `ancient-living`; UNESCO, 2016.
- Since the 1645 Shixian calendar, terms fall at 15° steps of apparent λ☉ (定氣).
  https://eco.mtk.nao.ac.jp/koyomi/faq/24sekki.html;
  https://en.wikipedia.org/wiki/Solar_term
- Pentads are 5° bins. NAOJ also describes a time-division method, and the two
  can differ by a day; label which is used.
- BaZi uses only the 12 jié as month edges. The current term and pentad are a
  distinct reading.
- The Japanese 72 kō (the 1874 Ryakuhonreki list; earlier lists 1685 and 1755)
  are a **NOTE**: an alternative name list on the same bins.
  https://ja.wikipedia.org/wiki/七十二候
- **Verdict: SHIP-LABELLED.**

**Chinese lunisolar date** (農曆: month, day, leap month).
- Not shown today: BaZi is solar, and the folk zodiac only *notes* the Lunar New
  Year flip.
- The official rule is the national standard **GB/T 33661-2017**:
  - months begin on the day of the new moon at UTC+8;
  - the month containing the winter solstice is month 11;
  - the leap month is the first month without a principal term (中氣) in a
    13-month year.
- **Researched in full in [many-skies-east-asia.md](./many-skies-east-asia.md)
  §1.** That record carries the algorithm, the vectors and the verdict; this one
  defers to it.
- **Verdict: SHIP-LABELLED** (per that record). It is the parent that unlocks
  these notes:
  - Korean (UTC+9; Dangi year = CE + 2333; 1997 Seollal = 8 Feb against Chinese
    New Year on 7 Feb);
  - Vietnamese (UTC+N since 1967; Tết 1985 = 21 Jan against Chinese New Year on
    20 Feb). https://en.wikipedia.org/wiki/Vietnamese_calendar
  - kyūreki (JST);
  - rokuyō (already on the phase-2 list).

**Bahá'í Badíʿ calendar.** `modern`: the Báb in the 1840s; Bahá'u'lláh, Kitáb-i-Aqdas, 1873.
- 19 months × 19 days: Bahá, Jalál, Jamál, ʿAẓamat, Núr, Raḥmat, Kalimát, Kamál,
  Asmáʼ, ʿIzzat, Mashíyyat, ʿIlm, Qudrat, Qawl, Masáʼil, Sharaf, Sulṭán, Mulk,
  ʿAláʼ.
- Ayyám-i-Há (4–5 days) falls between Mulk and ʿAláʼ.
- **Rule since 172 BE (2015):** Naw-Rúz is the day on which the March equinox
  falls **before sunset in Tehran**. The Twin Holy Birthdays fall on the 1st and
  2nd day after the 8th new moon following Naw-Rúz.
- Official table for 172–221 BE, from the Universal House of Justice:
  https://bahai.org/library/authoritative-texts/the-universal-house-of-justice/messages/20140710_001/20140710_001.pdf
  and https://bahaisofhilo.org/wp-content/uploads/2016/02/20141211_UHJ_50-Yr_Table_of_Dates_English.pdf
- **Vectors:**
  - Naw-Rúz 172 = 21 Mar 2015; 181 = 20 Mar 2024; 182 = 20 Mar 2025; 183 = 21 Mar 2026.
  - Twin Birthdays 182 = 22–23 Oct 2025.
  - Ayyám-i-Há 182 = 25 Feb – 1 Mar 2026.
- **Labels:**
  - The day begins at sunset; the after-sunset edge is NEEDS-LOCATION.
  - Before 2015 the Western convention fixed Naw-Rúz on 21 March. Applying the
    Tehran rule backwards to those births must be labelled.
- Tehran is a fixed reference point, so the result is plaintext.
- **Verdict: SHIP-LABELLED.**

**Burmese (Myanmar) lunisolar calendar.** `ancient-living`.
- Published open algorithm by Yan Naing Aye (2013, MIT):
  https://github.com/yan9a/mmcal;
  https://cool-emerald.blogspot.com/2013/06/algorithm-program-and-calculation-of.html
  - SY = 365.2587565 d; LM = 29.53058795 d.
  - From 1312 ME, watat if (SY·(my + 3739)) mod LM ≥ 22.2694539.
  - Thingyan (atat) time = SY·my + 1954168.050623.
  - Exception tables hold past irregular years.
- **Vector:** 23 May 2012 = Nayon waxing 3, 1374 ME.
- **Caveat:** future official years are set by the Calendar Advisory Board.
  Gislén & Eade (*JAHH* 22(3), 2019): no fixed rules for future dates.
- It also supplies the ME year needed for the full Mahabote house chart (phase 2
  in `daycount.js`).
- **Verdict: SHIP-LABELLED** ([…]).

**French Republican calendar.** `modern-1793`: Romme; day names by Fabre
d'Églantine.
- 12 × 30 days + 5–6 complementary days. Every day is named for a plant, animal,
  mineral or tool.
- **Two leap rules, contested:**
  - the legal rule: the autumn equinox at Paris Observatory (observed leap years
    III, VII, XI);
  - Romme's arithmetic, which R&D models as the "modified" form (IV, VIII, XII).
- **Vectors** (https://en.wikipedia.org/wiki/French_Republican_calendar):
  1 Vendémiaire I = 22 Sep 1792; 1 Vendémiaire = Raisin; 5 Floréal = Rossignol.
- **Verdict: SHIP-LABELLED** (name the rule; "proleptic after 1805").

**Japanese era (nengō).**
- Statutory under the 1979 Era Name Act. Vectors: 8 Jan 1989 = Heisei 1;
  1 May 2019 = Reiwa 1 (https://en.wikipedia.org/wiki/Japanese_era_name).
- It is an official table. Eras before 1873 need kyūreki conversion.
- **Verdict: SHIP-LABELLED** (low priority).

**Thai lunar calendar.**
- Eade/Gislén rules: https://thesiamsociety.org/wp-content/uploads/2000/03/JSS_088_0r_Eade_RulesForInterpolationInThaiCalendar.pdf
- The royal year type is not fully formula-fixed (2012 was disputed).
- **Verdict: SHIP-LABELLED, low priority.** A close cousin of the Burmese
  calendar; it may become a note on it.
- **Defer to [many-skies-thai.md](./many-skies-thai.md) §5**, the dedicated
  Thai record, wherever the two differ.

**Hindu lunisolar month, samvatsara and year numbers.** Covered in
[many-skies-vedic.md](./many-skies-vedic.md) §6, inside the Jyotisha parent.
The C.2 notes below defer to it.

### C.2 Notes on parents

| System | Parent | Why it is a note |
|---|---|---|
| Hindu lunisolar month (amanta/purnimanta), Vikram Samvat / Shaka years | Jyotisha (tithi) | Same tithi. Only the dark-fortnight month name shifts. VS = CE + 57; Shaka = CE − 78. Vector: Kartik 2026 runs 27 Oct – 24 Nov (purnimanta) / 10 Nov – 8 Dec (amanta) (https://samvat.in/months/kartik-2026/). Algorithm: https://www.cs.tau.ac.il/~nachum/calendar-book/papers/hindu-paper.pdf. The tithi at sunrise is NEEDS-LOCATION. |
| Nepal Sambat | Hindu lunisolar | Kartikadi amanta; epoch 20 Oct 879 (https://en.wikipedia.org/wiki/Nepal_Sambat) |
| Jain Vira Nirvana Samvat | Hindu lunisolar | VS + 470 from Kārtika Śukla 1. VNS 2553 begins 10 Nov 2026. |
| Kali ahargana | Jyotisha | Day 0 = 18 Feb 3102 BCE (Julian), JD 588465.5. Midnight versus sunrise convention, labelled. |
| Bikram Sambat (Nepal official) | Jyotisha (sidereal sankranti) | Month lengths are published yearly by committee; no formula reproduces them (https://github.com/rjach/sambat). Vector: 1 Baisakh 2083 = 14 Apr 2026. |
| Hindu regional solar calendars (Tamil, Malayalam/Kollam, Odia, Bengali, Assamese, Punjabi) | Jyotisha (the sidereal Sun sign is already shown) | Same sankranti moment. The day-of-month depends on the regional rule (sunrise, sunset, aparāhṇa or midnight), so that part is **NEEDS-LOCATION** (IMD: https://packolkata.imd.gov.in/INDIAN_CALADAR_PAC.pdf). |
| Korean, Vietnamese, kyūreki, rokuyō | Chinese lunisolar (C.1) | Same rules at a different meridian |
| Japanese 72 kō | Solar terms (C.1) | Same 5° bins, Japanese names |
| Armenian | Egyptian wandering-year kernel (A7) | 12 × 30 + 5; epoch 11 Jul 552 (R&D). Vectors: year 761 began 1 Jan 1312; year 1032 began 25 Oct 1582 (Julian) (https://en.wikipedia.org/wiki/Armenian_calendar). Own month names. |
| Mandaean | Egyptian-type kernel | 365 days, no leap; the 5 Parwanaya days follow month 8. Anchor 18 Jul 2019 = 1 Dowla (Häberl, via https://en.wikipedia.org/wiki/Mandaean_calendar). **Sources conflict for 2024** (16 Jul vs 20–21 Jul). Held until resolved. |
| Mongolian | Tibetan (phase 2) | Tibetan formulas, epoch JD 2359237 (Janson, https://arxiv.org/pdf/1401.6285) |
| Julian date, Berber/Amazigh (Yennayer = 1 Jan Julian; its era is modern-1980), Thai BE, Uyghur 12-animal | civil date / BaZi | Offsets or copies |

### C.3 Needs location

- **Hindu muhūrta / choghadiya.** Thirtieths and eighths of the day and night
  from sunrise and sunset. Private path, alongside vara-by-sunrise (already
  deferred).

### C.4 Do not ship

| System | Reason | Key reference |
|---|---|---|
| Hawaiian kaulana mahina, Tahitian moon nights | Night 1 (Hilo) is the first crescent *sighting* (David Malo), and island lists differ. A computed anchor would be our own choice. | https://guides.library.kapiolani.hawaii.edu/apdl/oahu/days |
| Māori maramataka / Matariki | 40+ iwi versions, some starting at the new moon and some at the full moon. Matariki's "Pipiri" identification is unpublished; only a 2022–2052 table exists. | https://www.mbie.govt.nz/assets/matariki-dates-2022-to-2052-matariki-advisory-group.pdf; https://www.tepapa.govt.nz/ |
| Andean / Inca | Reconstruction disputed (Zuidema's ceque calendar vs Bauer, Dearborn, Ziółkowski) | https://www.britannica.com/topic/Inca-calendar |
| Aboriginal Australian seasonal calendars | Ecological, […] (BoM) | http://bom.gov.au/iwk |
| Native American winter counts | Each year named by consensus after an event; counts differ by band | https://en.wikipedia.org/wiki/Winter_count |
| "Wolf Moon"-type full-moon names | Almanac popularisations, 1918–1960s; not a Native calendar | https://in-the-sky.org/article.php?term=full_moon_names |
| Hopi ceremonial timing | Horizon observation; restricted knowledge | (unverified) |
| Malagasy vintana | No published month-start rule; run by practitioners | https://en.wikipedia.org/wiki/Sikidy |
| Inuit, Muisca | Ecological / reconstruction contested | https://arxiv.org/pdf/0812.0574 (Muisca) |
| Ifá (unchanged) | Not computable by design | many-skies.md §0 |

---

## D. Engine notes for whoever implements this

**1. Shared kernels**, each a pure function:
- `wanderingYear(jdn, epochJdn)` for Egyptian, Kadmi, Shahanshahi and Armenian
  (and Mandaean with its own epagomenal placement).
- `alexandrian(rd, epoch)` for Ethiopian and Coptic.
- `hebrew(rd)` and `ummAlQura(rd)` as table plus tabular.
- `equinoxYear(year, refMeridian | refPlace, boundary)` for Jalali (52.5°E,
  noon), Bahá'í (Tehran, sunset) and French Republican (Paris).
- Longitude bins for manāzil (λ☾), gates (λ), solar terms and pentads (λ☉).

**2. Fixed reference places are not the being's location.** Mecca, Tehran,
52.5°E and Paris are part of the *rule*, so those outputs stay plaintext. Only
the **birth** place is private.

**3. Day-boundary edges are one shared concern.** These systems turn the day
away from midnight:

| System | Day starts |
|---|---|
| Hebrew, Hijri, Bahá'í | sunset |
| Zoroastrian | sunrise |
| Hindu | sunrise |
| Javanese weton | sunset (already labelled in `daycount.js`) |

Plaintext skies use the civil-date convention, labelled. The corrected edge (an
after-sunset or pre-dawn birth) is computed only on the private natal path once
location capture (task #21) exists.

**4. New astronomy needed:** mean node and apogee (Meeus polynomials), and
`SearchSunLongitude` for the design chart. Everything else is integer arithmetic
or existing calls.

**5. Tests.** The published vectors in §A–§C are the spine. Use real dates and no
mocks (RULE 0). **Never use holiday listings or feast days as vectors.** They are
moved for observance; see the Shahanshahi holiday and Genna cases above.

**6. Corrections this record makes to many-skies.md:**
- **§2.4 Arabic manāzil:** "near-duplicate" becomes **SHIP-LABELLED** (A6).
- **§2.4 hexagram gates:** the order and anchor are now verified (B1). That
  unblocks the `gates64` deferral.
- **§2.4 Sīh-rōzag:** realised as the Zoroastrian roz, with all three calendar
  variants shown (A4).
- **§2.4 Shabbat 156a:** the planetary hour is the same Chaldean scheme as the
  Hellenistic hours, so it is a NOTE (A1). The weekday teaching ships with the
  debate.
- **§2.4 Sabian:** index convention = round up; exact-integer edge contested (B4).
- **§2.4 Celtic tree calendar:** moved to the civil-locked class (C.0), labelled
  modern-1948. The exact date table is a later popular derivation.
- **§2.4 numerology:** confirmed DO-NOT-SHIP (B3).

---

## E. Remaining uncertainty (said, not hidden)

1. **Human Design:**
   - Only one published chart vector (a library README).
   - True versus mean node unverified.
2. **Manāzil:** no dated […] vector yet. The Warnock
   ephemeris has not been opened.
3. **Umm al-Qura:**
   - 1 Muḥarram 1446 = 7 Jul 2024 rests on van Gent alone.
   - Edge-case agreement between the recomputed post-1423 rule and the KACST
     table is untested.
4. **Persian:** the end of the 33-year rule's validity is contested (2088 CE /
   1501 AP / 1634 AP). It is uncontested for every birth to date.
5. **Zoroastrian:**
   - Iran's Bastani month structure and New-Year rule are unverified.
   - The Fasli year count is G − 630 versus G − 631.
6. **Ethiopian/Coptic:** church practice of 28 versus 29 Taḫśaś/Koiak for
   Christmas after a leap year is unverified. This does not affect the
   arithmetic.
7. **Aztec xiuhpohualli:** only two published vectors, probably one algorithm.
   Held.
8. **Maya 819:** no published modern-date vector; no inscription with an
   explicit direction glyph checked.
9. **Graves:** his own printed date ranges were not confirmed. Sources differ by
   a day.
10. **Igbo:** whether every town shares the common phase. Labelled.
11. **Sabian:** the US copyright renewal status of the 1953 book.
12. **Lunar phase families:** Rudhyar's exact bounds.
13. **Overlap with sibling records.** The Chinese lunisolar date, the Thai lunar
    date and the Hindu masa and year numbers are owned by
    [many-skies-east-asia.md](./many-skies-east-asia.md),
    [many-skies-thai.md](./many-skies-thai.md) and
    [many-skies-vedic.md](./many-skies-vedic.md). This record defers to them
    where they differ.
14. **Mandaean:** 2024 anchor conflict.
15. **Sefaria translation licence:** verify before quoting in product. The
    default is our own rendering.
16. **Search budget:** the research agents' web-search quota ran out partway
    through. Items marked unverified were not worked around.
