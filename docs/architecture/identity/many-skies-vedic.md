# MANY SKIES — Vedic: the full Jyotiṣa + Pañcāṅga structure

*Research record, 2026-10-19. Companion to [many-skies.md](./many-skies.md) (§0
doctrine, §2.3 the v1 Vedic engine). This record changes no code: it says what
the Vedic reading still lacks, how to compute each missing piece exactly, which
conventions are contested and must be labelled, which pieces need a birth place,
and which published values a test suite can be built on.*

**Method.** Six independent research passes ran in parallel: published panchanga
vectors, the nakshatra tables, dasha + nodes + ayanamsa, the divisional charts,
the lunisolar calendar, and the location-bound items. Each pass read
primary-leaning sources: raw library source code (PyJHora, VedAstro,
jyotishyamitra, Maitreya8, Swiss Ephemeris `sweph.h`), raw Wikipedia wikitext,
BPHS (Santhanam translation), PVR Narasimha Rao's textbook, Sewell & Dikshit
(1896), Reingold & Dershowitz code, and Drik Panchang / Prokerala pages. After
the passes, the current engine (`core/cosmos/skies/jyotisha.js` +
astronomy-engine) was run against the published vectors. Those runs are marked
**[our comparison]**. They are checks, not vectors. Every test vector below is a
value a source *published*.

**Verdict vocabulary.**
- **SHIP**: unambiguous, verified, location-free.
- **SHIP-LABELLED**: deterministic, but a contested convention must ride in the
  provenance.
- **NEEDS-LOCATION**: deterministic, but only on the private encrypted natal
  path.
- **DO-NOT-SHIP**: sources disagree with no defensible default, or the item is
  interpretation rather than coordinate, or it needs Founder's ruling.

---

## 0. Verdict summary

| # | Item | Verdict | Load-bearing convention |
|---|---|---|---|
| — | **Ayanamsa anchor fix (existing engine)** | **FIX FIRST** — current anchor is 5′26″ low | Lahiri realisation (IAE/Swiss Ephemeris mean vs Drik) |
| 1 | Seven grahas, sidereal rashi/nakshatra/pada | SHIP | (ayanamsa only) |
| 1 | Rahu/Ketu | SHIP-LABELLED | **mean node** default; true (osculating) node optional |
| 2 | D9 navamsa (planets) | SHIP | none (all sources agree) |
| 2 | D3, D4, D7, D10, D12, D16, D20, D24, D27, D30, D40, D45, D60 (planets) | SHIP-LABELLED | "Parashari (BPHS)" variant named per chart |
| 2 | D2 hora | SHIP-LABELLED | Parashara Leo/Cancer vs parivritti/Kashinatha/PVR |
| 2 | D60 benefic/malefic flags | DO-NOT-SHIP | 3-way source split + interpretation |
| 2 | Vargas of the lagna | NEEDS-LOCATION | — |
| 3 | Nakshatra lord, gana, nadi, yoni (+gender) | SHIP | — |
| 3 | Nakshatra deity, symbol | SHIP-LABELLED | Phalguni deity swap; symbol traditions |
| 3 | Nakshatra varna / rashi varna | DO-NOT-SHIP | 3 conflicting rashi mappings + caste content (Founder's call) |
| 3 | Nakshatra element (5-fold) | DO-NOT-SHIP (yet) | only 2 sources |
| 3 | 27 yoga names | SHIP | — |
| 3 | 11 karanas | SHIP (repo already correct) | — |
| 4 | Vimshottari MD/AD/PD timeline | SHIP-LABELLED | **dasha-year length** |
| 5 | Lunar month (amanta + purnimanta, adhika) | SHIP-LABELLED | instant-based reckoning; amanta/purnimanta both emitted |
| 5 | Samvatsara — southern (Shaka) | SHIP-LABELLED | Shaka year start |
| 5 | Samvatsara — northern (Bārhaspatya) | SHIP-LABELLED | Sewell 59c (bīja) + […] rule; press variant one ahead |
| 5 | Shaka / Vikram / Gujarati / Kali year numbers | SHIP-LABELLED | elapsed years; Chaitrādi vs Kārtikādi |
| 5 | Ritu | SHIP-LABELLED | Vedic (lunar month) vs Drik (tropical) vs sidereal-solar |
| 5 | Ayana | SHIP-LABELLED | tropical vs sidereal |
| 6 | Lagna, bhavas, sunrise vara, hora, Rahu kalam etc. | NEEDS-LOCATION | sunrise definition, bhava system, hora method |
| 7 | Rashi lords, exaltation/debilitation, own signs, natural friendship | SHIP | — |
| 7 | Moolatrikona ranges | SHIP-LABELLED | Moon 3° vs 4°, Mercury 15 vs 16 |
| 7 | Rahu/Ketu dignity | DO-NOT-SHIP | five schools |
| 7 | Yogini dasha | SHIP-LABELLED | year length |
| 7 | Ashtottari dasha | NEEDS-LOCATION (eligibility); periods SHIP-LABELLED | applicability rule disputed |
| 7 | Combustion | SHIP-LABELLED | Surya Siddhanta orbs vs variants |
| 7 | Retrograde | SHIP (already in natal-chart.js) | — |
| 7 | Graha yuddha, gandanta, panchaka | SHIP-LABELLED | widths / winner rule |
| 7 | Anandadi yoga, panchaka sub-type, paya-by-house | NEEDS-LOCATION | sunrise vara / lagna |

---

## 1. CRITICAL — the engine's Lahiri anchor is 5′26″ too low

`jyotisha.js` anchors Lahiri at **24°07′47″ on 2026-01-01**. Published values
show 24°07′47″ is the Lahiri value for **late 2019**:

| Instant | Published Lahiri | Source |
|---|---|---|
| J2000.0 (2000-01-01 12h TT), mean | **23°51′25.53″** | IAE 2019 p.429, reproduced in Swiss Ephemeris docs App. E — https://www.astro.com/swisseph/swisseph.htm |
| 2019-01-01, true | 24°07′05.99″ | IAE 2019 via SE App. E |
| 2020-01-01, true | 24°07′54.84″ | SE App. E |
| 2026-01-01, mean | **24°13′13″** | vastuguruji.com (Swiss-Ephemeris based) — https://vastuguruji.com/ayanamsa-calculation/ |
| 2026-01-01 0h UT, true | ≈24°13′19″ | jagannathhora.com/lahiri-ayanamsa-value/ (the same page also prints "approximately 24°07′" for 2026, contradicting itself; this stray line may be where the repo's figure came from) |
| 2023-08-15 (Drik day page) | 24.193754° | Drik Panchang, New Delhi |
| 2026-10-19 (Drik day page) | 24.238165° | Drik Panchang, New Delhi |

**[our comparison]** Published Drik/Prokerala transition times, set against the
engine with the repo anchor and with a re-anchored mean Lahiri (24.220306° =
24°13′13.1″ at 2026-01-01, same 50.29″/yr slope):

| Published event (IST) | Source | Repo anchor | Re-anchored |
|---|---|---|---|
| Pushya → Ashlesha, 2023-08-15 13:59 | Drik | 13:47 | **13:58** |
| Vyatipata yoga ends, 2023-08-15 17:33 | Drik | 17:12 | **17:32** |
| Uttara Ashadha → Shravana, 2026-10-19 15:38 | Drik + Prokerala | 15:27 | **15:38** |
| Dhriti yoga ends, 2026-10-20 00:35 | Drik | 00:14 | **00:34** |
| Pushya ends, 2023-07-19 07:58 | Prokerala | 07:47 | **07:58** |
| Ashtami tithi ends, 2026-10-19 10:51/10:52 | Drik/Prokerala | 10:52 | 10:52 (ayanamsa cancels) |

**Shape vs offset.** The linear 50.29″/yr model is correct in shape. Over
1900–2100 its error against the Swiss Ephemeris precession-model mean Lahiri
varies by only about 1.3″. Only the constant is wrong, by about −326″. This was
computed with pyswisseph 2.10.03, so it is a research-pass computation rather
than a published figure.

**Impact today.** Every sidereal longitude is about 0.09° too high. That gives:
- About 2.7% of births a wrong **pada**, and therefore a wrong **Nāmakaraṇa
  syllable**.
- About 0.7% of births a wrong nakshatra.
- About 1.4% of births a wrong yoga (the sum doubles the error).
- A Vimshottari balance off by up to 0.68% of the lord's years, which is about
  50 days for Venus.

Tithi and karana are unaffected. `many-skies.md` §2.3 and the provenance string
("Swiss-Ephemeris-verified") carry the same wrong figure.

**Recommended fix (for whoever owns jyotisha.js; not done here):** keep the
linear model and re-anchor it. Use 24°13′13.1″ **mean** at 2026-01-01T00:00Z, or
equivalently 23°51′25.53″ mean at J2000.0 TT (IAE).

**The definition to cite:**
- IAE 1985: 23°15′00.658″ at 1956-03-21 0h TDT, IAU-1976 precession, which is
  Swiss Ephemeris `SE_SIDM_LAHIRI`.
- The older ICRC value is 23°15′00.0″, which is `SE_SIDM_LAHIRI_ICRC`. The two
  differ by about 1.1″ today.

**Implementations differ at the 20–45″ level. Label the realisation.**
**[our comparison]** We inverted Drik's sidereal planet tables against
astronomy-engine tropical longitudes:
- 1996-12-10: Drik implies 23.8208°.
- 2026-10-19: Drik implies 24.2372°.
- Both are about **+22″ above SE mean Lahiri**. Nutation does not explain the
  gap; Δψ was about +1″ and +10″ on those dates.
- Prokerala runs a further ~24″ above Drik.

**Rules that follow:**
- The engine's provenance should read […].
- A mean ayanamsa paired with true-of-date planet longitudes carries up to ±17″
  of unmodelled nutation. This is acceptable and should be documented; adding
  Δψ makes it "true".
- **Test tolerance when asserting Drik/Prokerala values: ≥30″ on longitudes,
  ±1–2 min on Moon-boundary times.**

---

## 2. Item 1 — the nine grahas in the sidereal zodiac

### 2.1 Sun … Saturn — SHIP
`sid = posMod(tropical − ayanamsa, 360)`. The tropical value is astronomy-engine
apparent geocentric ecliptic-of-date, `natal-chart.js eclipticLongitude`. From
it:
- rashi = `floor(sid/30)`
- nakshatra = `floor(sid/13°20′)`
- pada = `floor((sid mod 13°20′)/3°20′)+1`

These are the same formulas the Moon already uses. Retrograde is already
computed in `natal-chart.js`.

**[our comparison]** Using Drik-implied ayanamsa, astronomy-engine reproduces
every Drik sidereal planet:
- 1996-12-10: within 5″.
- 2026-10-19: within 8″, except Moon 29″ and Venus 17″. The Moon gap is
  consistent with Drik's live page time stamp being about 50 s off.

The ephemeris is not the weak link; the ayanamsa is.

Uranus, Neptune and Pluto are not grahas. Do not add them to the Vedic block.

### 2.2 Rahu / Ketu — SHIP-LABELLED (mean default)

**What practice uses:**

| Authority | Node |
|---|---|
| Drik Panchang default | **Mean**: […] True = "Spashta". https://www.drikpanchang.com/planet/position/planetary-positions-sidereal.html |
| Indian Astronomical Ephemeris / Rashtriya Panchang | **Mean** (table headed "MEAN RAHU") |
| Maitreya8 Vedic default | Mean (`LUNAR_NODE_MEAN`) — https://github.com/martin-pe/maitreya8 |
| AstroSage | Mean. Its Gandhi chart Rahu is 12°08′44″, against mean 12°08′46″ and true 13°39′33″ (research-pass check) |
| Surya Siddhanta / classical | Mean only; nodes "always retrograde" |
| PyJHora current default | True nodes, and TRUE_PUSHYA ayanamsa (README v4.6.0) — https://github.com/naturalstupid/PyJHora |
| PVR Narasimha Rao | Has reversed himself: […] (2005, jyotish-blog) → […] (2025, x.com/homam108) |
| KP | Mostly mean (AstroSage KP FAQ) |

**Decision:** emit **mean** Rahu as primary, labelled, and true Rahu as a labelled
secondary.

**Mean node.** Meeus, *Astronomical Algorithms*, ch.22 (nutation arguments),
referred to the mean equinox of date:

```
T = (JD_TT − 2451545.0) / 36525
Ω = 125.04452° − 1934.136261·T + 0.0020708·T² + T³/450000
Rahu_trop = Ω mod 360 ; Ketu = Rahu + 180°
```

Corroboration: NREL SPA TP-560-34302 Eq.19, https://docs.nlr.gov/docs/fy08osti/34302.pdf.
astronomy-engine's `MakeTime(d).tt` is days from J2000 TT, so T = tt/36525.

**[our comparison]** This formula reproduced Drik's mean Rahu within 1–4″ of the
planets' implied ayanamsa on both test dates. The mean node is always
retrograde, at −0.05295°/day.

**True node.** Swiss Ephemeris's "true node" is the **osculating** node: the
ascending node of the plane spanned by the Moon's instantaneous geocentric
position and velocity. astronomy-engine has no node-longitude function, but it
does have `GeoMoonState`. Rotate r and v into the ecliptic of date
(`Rotation_EQJ_ECT`), then compute:
- `h = r × v`
- `Ω_true = atan2(h_x, −h_y)`

**[our comparison]** This reproduced Drik's Spashta Rahu to within 6–15″ on
1996-12-10 and 2026-10-19.

True minus mean reaches about ±1.98° over 1900–2100 (research-pass computation).
The true node moves direct about 26% of the time.

### 2.3 Test vectors (published)

**Drik, sidereal Lahiri.** Times are local; plain Rahu is mean, Spashta is true.

| Instant | Body | Drik longitude | Nakshatra-pada |
|---|---|---|---|
| Delhi 1996-12-10 12:29:00 IST | Surya | 234°40′58.59″ | Jyeshtha 3 |
| | Chandra | 229°08′45.06″ | Jyeshtha 1 |
| | Mangal | 146°54′36.39″ | Uttara Phalguni 1 |
| | Budha | 254°06′12.61″ | Purva Ashadha 1 |
| | Guru | 266°28′29.27″ | Purva Ashadha 4 |
| | Shukra | 207°31′52.76″ | Vishakha 3 |
| | Shani | 336°49′45.85″ | Uttara Bhadrapada 2 |
| | Rahu (mean) / Spashta | 160°23′01.92″ / 161°16′33.81″ | Hasta 1 / Hasta 1 |
| New Delhi 2014-03-07 00:28:29 IST | Surya / Chandra | 322°03′44.69″ / 31°55′25.44″ | P.Bhadrapada 1 / Krittika 2 |
| | Mangal (R) / Shani (R) | 183°18′29.19″ / 209°14′36.11″ | Chitra 3 / Vishakha 3 |
| | Rahu mean / Spashta | 186°46′21.70″ / 185°10′17.26″ | Swati 1 / Chitra 4 |
| New Delhi 2022-03-18 03:27:17 IST | Surya / Chandra | 333°06′33.74″ / 148°16′28.92″ | P.Bhadrapada 4 / U.Phalguni 1 |
| | Rahu mean / Spashta | 31°20′26.02″ / 29°50′25.35″ | Krittika 2 / Krittika 1 |
| New Delhi 2026-10-19 15:22:50 IST | Surya / Chandra | 181°47′46.95″ / 279°52′18.57″ | Chitra 3 / U.Ashadha 4 |
| | Guru / Shukra (R) / Shani (R) | 118°22′57.12″ / 189°20′05.95″ / 345°54′55.64″ | Ashlesha 4 / Swati 1 / U.Bhadrapada 4 |
| | Rahu mean / Spashta | 302°29′58.74″ / 303°47′55.28″ | Dhanishtha 3 / Dhanishtha 4 |

**Sources for the table above:**
- 1996: Wayback `web.archive.org/web/20220101121816id_/…planetary-positions-sidereal.html?geoname-id=1273294&date=10/12/1996&time=12:29:00`.
- 2014: Wayback snapshot `20251020083443`.
- 2022: Wayback snapshot `20220317150219`.
- 2026: live page, 2026-10-19.

**Prokerala, sidereal Lahiri (mean node inferred).** Instants are UT, location
Reykjavik (GMT). POST to https://www.prokerala.com/astrology/planet-positions-sidereal.php.
Prokerala runs about 24″ above Drik.

| Body | 2000-01-01 00:00 UT | 2023-08-15 12:00 UT | 2026-01-01 00:00 UT |
|---|---|---|---|
| Surya | 256.002° P.Ashadha 1 | 118.234° Ashlesha 4 | 256.348° P.Ashadha 1 |
| Chandra | 193.436° Swati 3 | 108.408° Ashlesha 1 | 42.495° Rohini 1 |
| Mangal | 303.718° Dhanishta 4 | 148.14° U.Phalguni 1 | 258.468° P.Ashadha 2 |
| Budha | 247.255° Mula 3 | 144.76° P.Phalguni 4 | 244.431° Mula 2 |
| Guru | 1.376° Ashwini 1 | 20.737° Bharani 3 | 87.137° (R) Punarvasu 3 |
| Shukra | 217.104° Anuradha 2 | 115.026° (R) Ashlesha 3 | 254.986° P.Ashadha 1 |
| Shani | 16.549° (R) Bharani 1 | 310.535° (R) Shatabhisha 2 | 331.947° P.Bhadrapada 4 |
| Rahu | 101.21° Pushya 3 | 4.024° Ashwini 2 | 317.95° Shatabhisha 4 |

---

## 3. Item 2 — divisional charts (vargas)

Every varga is a pure function of one sidereal longitude, so **planet vargas
are location-free**. Lagna vargas need the lagna, so they are NEEDS-LOCATION.

**Notation:**
- `s = floor(lon/30)` (Aries = 0).
- `d = lon mod 30`.
- `k = floor(d·n/30)` for an n-fold division.
- **Odd sign** means Aries, Gemini, … , which are *even* indices 0, 2, 4, …
  This parity off-by-one is a known trap.
- Movable = {0,3,6,9}, fixed = {1,4,7,10}, dual = {2,5,8,11}.

**Sources:**
- BPHS ch.6, Santhanam: https://archive.org/download/BPHSEnglish/BPHS%20-%201%20RSanthanam.pdf
- PVR, *Vedic Astrology: An Integrated Approach* §6.2: https://www.vedicastrologer.org/articles/vedic_astro_textbook.pdf
- PyJHora `jhora/horoscope/chart/charts.py`
- VedAstro `Library/Logic/Calculate/Vargas.cs` (K.S. Charak tables): https://github.com/VedAstro/VedAstro

All four agree on every Parashari rule below.

### 3.1 The Parashari rules

| Varga | Part size | Varga sign (Parashari / BPHS) | Main variants |
|---|---|---|---|
| D1 Rāśi | 30° | `s` | — |
| D2 Horā | 15° | odd sign: 0–15° → Leo, 15–30° → Cancer; even sign: reverse | parivritti `(2s+k) mod 12`; Kashinatha (lord's day/night sign); PVR "Uma-Shambhu" (PyJHora's current default) — **label** |
| D3 Drekkāṇa | 10° | `(s + 4k) mod 12` (1st/5th/9th) | Jagannātha (movable/fixed/dual of the element), Somanātha, parivritti `(3s+k)` |
| D4 Chaturthāṁśa | 7°30′ | `(s + 3k) mod 12` | parivritti, Somanātha |
| D7 Saptāṁśa | 30/7° | odd: `(s+k)`; even: `(s+6+k) mod 12` | even-sign reversals |
| **D9 Navāṁśa** | 3°20′ | movable from itself, fixed from 9th, dual from 5th, which is identical to **`floor(lon / 3°20′) mod 12` = `(9s + k) mod 12`** (fire→Ar, earth→Cp, air→Li, water→Cn) | Kalachakra navamsa, nadi navamsa (non-default) |
| D10 Daśāṁśa | 3° | odd: `(s+k)`; even: `(s+8+k) mod 12` | even-sign reversals |
| D12 Dvādaśāṁśa | 2°30′ | `(s + k) mod 12` | even reversal |
| D16 Ṣoḍaśāṁśa | 1°52′30″ | start Ar/Le/Sg for movable/fixed/dual, + k | — |
| D20 Viṁśāṁśa | 1°30′ | start Ar/**Sg**/**Le** for movable/fixed/dual, + k | — |
| D24 Chaturviṁśāṁśa | 1°15′ | odd from Leo, even from Cancer, both forward | even backward |
| D27 Bhāṁśa | 1°06′40″ | start Ar/Cn/Li/Cp for fire/earth/air/water, + k | Saravali differs (Santhanam rejects it) |
| D30 Triṁśāṁśa | unequal | odd: 0–5 Ar, 5–10 Aq, 10–18 Sg, 18–25 Ge, 25–30 Li; even: 0–5 Ta, 5–12 Vi, 12–20 Pi, 20–25 Cp, 25–30 Sc (half-open bands) | parivritti, Somanātha |
| D40 Khavedāṁśa | 45′ | odd from Ar, even from Li, + k | — |
| D45 Akṣavedāṁśa | 40′ | start Ar/Le/Sg for movable/fixed/dual, + k | — |
| D60 Ṣaṣṭyaṁśa | 30′ | `(s + floor(2d)) mod 12`, counted from the occupied sign (Santhanam, PVR, VedAstro, PyJHora default) | count from Aries |

**Navamsa = pada.** 3°20′ is both the navamsa and the pada width, and
27·4 = 108 = 12·9, so pada *p* of nakshatra *n* is navamsa
`(4n + p − 1) mod 12`. The navamsa can therefore be printed beside every
nakshatra-pada. This is derived, and is consistent with vedalight.in's
statement; there is no classical quote for it.

**Vargottama:** the same sign in D1 and D9 (PVR fn.40). **SHIP.**

**Collections.**
- Shodasavarga = D1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60
  (BPHS 6.2–4).
- Shadvarga = D1, 2, 3, 9, 12, 30.
- Dashavarga = D1, 2, 3, 7, 9, 10, 12, 16, 30, 60.

**D60 names** (Santhanam; odd signs run 0→30°, even signs reverse): Ghora,
Rakshasa, Deva, Kubera, Yaksha, Kinnara, Bhrashta, Kulaghna, Garala, Vahni, Maya,
Purishaka, Apampathi, Marutwan, Kala, Sarpa, Amrita, Indu, Mridu, Komala,
Heramba, Brahma, Vishnu, Maheswara, Deva, Ardra, Kalinasa, Kshiteesa,
Kamalakara, Gulika, Mrithyu, Kaala, Davagni, Ghora, Yama, Kantaka, Sudha, Amrita,
Poornachandra, Vishadagdha, Kulanasa, Vamsakshaya, Utpata, Kaala, Saumya,
Komala, Seetala, Karaladamshtra, Chandramukhi, Praveena, Kalapavaka,
Dandayudha, Nirmala, Saumya, Kroora, Atiseetala, Amrita, Payodhi, Bhramana,
Chandrarekha. PyJHora uses the same list; Wikipedia's list differs.
- Names: **SHIP-LABELLED** (BPHS/Santhanam).
- Benefic/malefic flags: **DO-NOT-SHIP**. Santhanam, PyJHora and Wikipedia all
  disagree (e.g. #7, #36, #41, #55), and the flags are interpretation, not
  coordinate.

### 3.2 Test vectors (published)

All from PVR's textbook §6.2 except where noted.

| Source | Input | Published |
|---|---|---|
| PVR Ex.16 (D9) | Gemini 11°, Scorpio 19° | **Capricorn, Sagittarius** (PyJHora asserts (9,8)) |
| PVR Ex.11 (D3) | Gemini 3°, 19°, 21° | Gemini, Libra, Aquarius |
| PVR Ex.12 (D4) | Taurus 3°, 14°, 23° | Taurus, Leo, Aquarius |
| PVR Ex.14 (D7) | Ge 10°, Vi 19° | Leo, Cancer |
| PVR Ex.17 (D10) | Ge 10°, Sc 19° | Virgo, Capricorn |
| PVR Ex.19 (D12) | Ge 11°, Sc 19° | Libra, Gemini |
| PVR Ex.20 / 21 / 22 (D16/D20/D24) | Ge 11°, Sc 19° | Ta, Ge / Pi, Sg / Ar, Li |
| PVR Ex.23 / 24 / 25 (D27/D40/D45) | Ge 11°, Sc 19° | Le, Ge / Ge, Sc / Ar, Sg |
| PVR Ex.26 (D60) | Jupiter Sc 12°58′ | Sagittarius |
| PVR Ex.27 (Bill Cosby, Jupiter Sg 29°49′) | all 16 vargas | D2 Cn, D3 *Li*, D4 Vi, D7 Ge, **D9 Sg (vargottama)**, D10 Vi, D12 Sc, D16 Pi, D20 Pi, D24 Cn, D27 Ge, D30 Li, D40 Cn, D45 Le, D60 Sc |
| Santhanam BPHS ch.6 note (D60) | Venus Capricorn 13°25′ | Pisces |
| PVR hora paper (https://www.vedicastrologer.org/articles/hora.pdf) | Jupiter Ta 10°21′; Mars Sg 18°53′ | Moon's hora (Cancer) for both |

Notes on these vectors:
- Ex.27's D3 "Li" is almost certainly a book typo. No drekkana school maps
  Sg 29°49′ to Libra, and PyJHora's test comments "In Book D-3=6".
- PyJHora's expected D2 for Ex.27 is Virgo, because of its non-Parashari
  default. The book says Cn.
- PVR Ex.15 (D8) has an internal typo. Do not use it.

---

## 4. Item 3 — the per-nakshatra tables, yogas, karanas

### 4.1 Core columns — SHIP

**Lord** follows the repo's `DASHA_LORDS[n mod 9]`.

**Sources:**
- PyJHora `const.py` / `match/compatibility.py`.
- VedAstro `MatchReportFactory.cs` / `BodyTypes.razor`.
- Saravali (Maitreya docs) `koota_*.html`: https://saravali.github.io/astrology/
- Wikipedia raw "Nakshatra".
- srath.com tables.
- goravani.com tables.

Lord, gana, nadi and yoni (animal + gender) are unanimous across every source
that carries them.

| # | Nakshatra | Lord | Deity (devatā) | Gana | Yoni | Nadi |
|---|---|---|---|---|---|---|
| 1 | Ashwini | Ketu | Ashvini Kumaras | Deva | Horse ♂ | Adi |
| 2 | Bharani | Venus | Yama | Manushya | Elephant ♂ | Madhya |
| 3 | Krittika | Sun | Agni | Rakshasa | Sheep/Goat ♀ | Antya |
| 4 | Rohini | Moon | Prajapati (Brahma) | Manushya | Serpent ♂ | Antya |
| 5 | Mrigashira | Mars | Soma | Deva | Serpent ♀ | Madhya |
| 6 | Ardra | Rahu | Rudra | Manushya | Dog ♀ | Adi |
| 7 | Punarvasu | Jupiter | Aditi | Deva | Cat ♀ | Adi |
| 8 | Pushya | Saturn | Brihaspati | Deva | Sheep/Goat ♂ | Madhya |
| 9 | Ashlesha | Mercury | Sarpas (Nagas) | Rakshasa | Cat ♂ | Antya |
| 10 | Magha | Ketu | Pitris | Rakshasa | Rat ♂ | Antya |
| 11 | Purva Phalguni | Venus | Bhaga † | Manushya | Rat ♀ | Madhya |
| 12 | Uttara Phalguni | Sun | Aryaman † | Manushya | Cow ♂ | Adi |
| 13 | Hasta | Moon | Savitr | Deva | Buffalo ♀ | Adi |
| 14 | Chitra | Mars | Tvashtar (Vishvakarma) | Rakshasa | Tiger ♀ | Madhya |
| 15 | Swati | Rahu | Vayu | Deva | Buffalo ♂ | Antya |
| 16 | Vishakha | Jupiter | Indra-Agni | Rakshasa | Tiger ♂ | Antya |
| 17 | Anuradha | Saturn | Mitra | Deva | Deer/Hare ♀ | Madhya |
| 18 | Jyeshtha | Mercury | Indra | Rakshasa | Deer/Hare ♂ | Adi |
| 19 | Mula | Ketu | Nirriti | Rakshasa | Dog ♂ | Adi |
| 20 | Purva Ashadha | Venus | Apah (the Waters) | Manushya | Monkey ♂ | Madhya |
| 21 | Uttara Ashadha | Sun | Vishvedevas | Manushya | Mongoose ♂ ‡ | Antya |
| 22 | Shravana | Moon | Vishnu | Deva | Monkey ♀ | Antya |
| 23 | Dhanishtha | Mars | Vasus | Rakshasa | Lion ♀ | Madhya |
| 24 | Shatabhisha | Rahu | Varuna | Rakshasa | Horse ♀ | Adi |
| 25 | Purva Bhadrapada | Jupiter | Aja Ekapada | Manushya | Lion ♂ | Adi |
| 26 | Uttara Bhadrapada | Saturn | Ahirbudhnya | Manushya | Cow ♀ | Madhya |
| 27 | Revati | Mercury | Pushan | Deva | Elephant ♀ | Antya |

Notes on the table:
- Nadi names have synonyms: Adi/Madhya/Antya = Vata/Pitta/Kapha.
- **†** Bhaga for Purva Phalguni and Aryaman for Uttara Phalguni is the reading
  of Wikipedia, Drik, Goravani, the Vedanga Jyotisha (dharmawiki) and Brihat
  Samhita 98. srath.com's Shakti table and the Taittiriya Brahmana swap them.
  **Deity: SHIP-LABELLED.**
- **‡** The Mongoose has no female among the 27. Saravali pairs it with Abhijit
  in the 28-scheme.
- Outliers rejected:
  - Mula = "Rakshasa" (srath main table, which contradicts its own Shakti
    table) / "Prajāpati" (Iyer BS translation slip).
  - Revati = "Puṣya" (BS typo).
  - PyJHora `nakshatra_rulers`, a misaligned D27 amsa list. **Never use it for
    devatas.**
- **Spelling:** the engine writes `Dhanishta`, `namakarana.js` writes
  `Dhanishtha`. The join is by index, so this is harmless today. Unify the
  spelling if anything ever joins by name.

### 4.2 Symbols — SHIP-LABELLED (primary + alternates)
Truly independent sources are Wikipedia, srath.com and goravani; Drik copies
Wikipedia. Ship the Wikipedia/Drik form as primary and the others as alternates:

| # | Primary symbol | Notable alternates |
|---|---|---|
| 1 | Horse's head | — |
| 2 | Yoni | — |
| 3 | Knife / spear | razor, dagger |
| 4 | Cart / chariot | temple, banyan |
| 5 | Deer's head | — |
| 6 | Teardrop | diamond, human head, gem |
| 7 | Bow and quiver | house |
| 8 | Cow's udder | lotus, arrow, circle, flower |
| 9 | Serpent | wheel |
| 10 | Royal throne | palanquin |
| 11 | Front legs of bed | hammock, fig tree, stage |
| 12 | Four legs of bed | back legs of cot |
| 13 | Hand / fist | palm |
| 14 | Bright jewel / pearl | — |
| 15 | Shoot of plant / coral | sapphire |
| 16 | Triumphal arch | potter's wheel |
| 17 | Triumphal archway | lotus, heap of rice, umbrella |
| 18 | Circular amulet / earring | umbrella |
| 19 | Bunch of roots | elephant goad; lion's tail (srath, goravani) |
| 20 | Elephant tusk | fan, winnowing basket |
| 21 | Elephant tusk | small bed, square |
| 22 | Ear / three footprints | arrow |
| 23 | Drum / flute | — |
| 24 | Empty circle | 1,000 flowers or stars |
| 25 | Swords | front legs of funeral cot, two-faced man |
| 26 | Twins | back legs of funeral cot, snake in water |
| 27 | Fish / pair of fish | drum |

### 4.3 Varna and element — DO-NOT-SHIP

Two different "varna" readings exist, and they disagree:
1. **A nakshatra 7-fold scheme.** srath, goravani and ganeshmitra agree on the
   grouping. The labels are caste and outcaste terms: "Mleccha", "Outcaste",
   "Butcher".
2. **A Moon-rashi 4-fold scheme, which is the Avakahada/koota standard.** It has
   **three conflicting mappings**:
   - water/fire/earth/air = Brahmin/Kshatriya/Vaishya/Shudra (anytimeastro,
     kundli software).
   - air ↔ earth swapped (Saravali/Maitreya, PyJHora).
   - a third mapping in VedAstro `BirthVarna`.

There is no defensible default, and the content is a caste hierarchy applied to
a being. **Founder's ruling is needed before any form ships.**

The nakshatra 5-element scheme has only two sources (astrodranjna,
jyotishmadesimple). Hold it until a third source is found.

### 4.4 The 27 yogas — SHIP

Order agreed by Wikipedia raw "Nityayoga", PyJHora, VedAstro `NithyaYoga.cs` and
jyotishyamitra (which rotates the list by one for its own modulo indexing).

**The yoga names, in order:**
1 Vishkambha · 2 Priti · 3 Ayushman · 4 Saubhagya · 5 Shobhana · 6 Atiganda ·
7 Sukarma · 8 Dhriti · 9 Shula · 10 Ganda · 11 Vriddhi · 12 Dhruva ·
13 Vyaghata · 14 Harshana · 15 Vajra · 16 Siddhi · 17 Vyatipata · 18 Variyan ·
19 Parigha · 20 Shiva · 21 Siddha · 22 Sadhya · 23 Shubha · 24 Shukla ·
25 Brahma · 26 Indra · 27 Vaidhriti.

**Common spelling variants:**
- Shula = Soola
- Variyan = Variyana
- Vaidhriti = Vaidhrita
- Vishkambha = Vishkumbha

The engine's `yoga.index` (1-based) maps straight onto this list.

**Published vectors:**
- Drik 2023-08-15: Vyatipata → Variyana.
- Drik 2026-10-19: Dhriti → Shula.
- Drik 2012-03-22 (US): Shukla → Brahma.
- Drik 2023-07-18 (US): Vajra → Siddhi.
- Prokerala 2021-04-13: Vishkambha → Priti.

### 4.5 The 11 karanas — SHIP (the repo is correct)

With 0-based `slot = floor(((λ☾−λ☉) mod 360)/6)`, the repo's `karanaName` gives:
- slot 0 = Kimstughna.
- slots 1–56 = movable `[Bava, Balava, Kaulava, Taitila, Gara, Vanija, Vishti][(slot−1) mod 7]`.
- slots 57/58/59 = Shakuni / Chatushpada / Naga.

This matches Wikipedia raw "Karaṇa" ([…]), VedAstro `Karana()`, and PyJHora's 60-entry list. Vishti
lands on Shukla 4b, 8a, 11b, 15a and Krishna 3b, 7a, 10b, 14a, which is the
standard Bhadra list.

Known errors elsewhere:
- jyotishyamitra swaps Kaulava/Gara at its slots 32/34. That is a bug in that
  library.
- Spelling variants: Vishti = Bhadra, Kimstughna = Kinstughna, Naga = Nagava.

**Published vectors:**
- Drik 2023-08-15: Shakuni → Chatushpada → Nagava.
- Drik 2012-03-22: Nagava → Kinstughna → Bava.
- Drik 2026-10-19: Bava → Balava → Kaulava.
- Prokerala 2023-07-18: Kimstughna → Bava → Balava.

### 4.6 Tithi names, vara lords — SHIP

**Tithi names:**
- Shukla 1–15: Pratipada, Dvitiya, Tritiya, Chaturthi, Panchami, Shashthi,
  Saptami, Ashtami, Navami, Dashami, Ekadashi, Dvadashi, Trayodashi,
  Chaturdashi, **Purnima**.
- Krishna 16–29 repeat Pratipada … Chaturdashi, and 30 is **Amavasya**.

**Vara lords:** Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Sunday-first.
Sources agree.

**Label:** the engine's tithi is *tātkālika*, the value at the birth instant,
which is what kundali software reports. A panchanga's day-tithi is the *udaya*
(sunrise) tithi, which needs location. Say which one is reported.

### 4.7 Abhijit (the 28th) — record only

Abhijit spans 276°40′ to 280°53′20″ sidereal: the last pada of Uttara Ashadha
plus the first 1/15 of Shravana. Its deity is Brahma. It is used only in
muhurta, Sarvatobhadra, Anandadi yoga and Ashtottari. It is never a janma
nakshatra in the 27-scheme. Do not emit it as the birth star.

---

## 5. Item 4 — the Vimshottari timeline — SHIP-LABELLED

**Algorithm** (PyJHora `dhasa/graha/vimsottari.py`, Maitreya8 `GenericDasa.cpp`,
Wikipedia "Dasha (astrology)", B.V. Raman *Hindu Predictive Astrology* ch.12):

```
n        = floor(λ☾_sid / 13°20′); lord = CYCLE[n mod 9]
elapsed  = (λ☾_sid mod 13°20′) / 13°20′
MD_start = birth − elapsed · YEARS[lord] · Y      // notional, BEFORE birth
MD_i     : consecutive, cyclic from lord, each YEARS[L]·Y long (Σ = 120 years)
AD (bhukti) in MD of L: starts with L itself, cyclic; AD(S) = YEARS[L]·YEARS[S]/120 years
PD (pratyantar) in AD S of MD L: starts with S; PD(P) = YEARS[L]·YEARS[S]·YEARS[P]/120² years
```

**The subdivisions start from the notional MD start, not from birth.** This is
confirmed in both codebases and in published output. In PyJHora test 6, Rahu MD
and Rahu/Rahu both start on 1996-07-16, five months before the 1996-12-07 birth.

**The contested element: Y, the dasha-year length.** It must ride in provenance.

| Convention | Days | Who |
|---|---|---|
| Julian "astronomical solar year" | 365.25 | Wikipedia; Maitreya8 Vedic default (`yearLength = 0` → 365.25); Shyamasundara Dasa; consistent with AstroSage output |
| True sidereal solar year (Sun returns 360° sidereal) | ≈365.256 (true arc) | JHora default per PVR ([…], https://www.vedicastrologer.org/articles/pp_tajaka.pdf); PyJHora `JHORA_DEFAULT`; Phaladeepika 19.4 |
| Mean sidereal | 365.256364 | PyJHora unit tests |
| Mean tropical | 365.2422 | K.N. Rao (per PVR) |
| Sāvana | 360 | an option in JHora/Maitreya; about 1.46% shorter, roughly 94 days over a Rahu MD |
| Drik Panchang | **not stated** | only a third-party claim of 365.25 (roxyapi.com) |

**Recommendation:** default to **365.25** ("Julian solar year"), labelled, and
expose the others as named options. All three solar choices stay within about a
day over 120 years; only 360 is materially different.

**Published vectors.** Each must be asserted under *its* convention.
- **PyJHora `tests/pvr_tests.py` `_vimsottari_test_6`.** Inputs: Chennai
  13.0389N 80.2619E, 1996-12-07 10:34 IST. Settings: Lahiri, mean nodes,
  Y = 365.256364. Published MD starts:
  - Rahu 1996-07-16 01:12:44
  - Jupiter 2014-07-16 15:57:42
  - Saturn 2030-07-16 18:24:19
  - Mercury 2049-07-16 15:18:26
  - Ketu 2066-07-16 23:54:14
  - Venus 2073-07-16 18:58:23
  - Sun 2093-07-16 22:01:40
  - Moon 2099-07-17 10:56:39
  - Mars 2109-07-18 00:28:17
  - First AD after Rahu/Rahu: Rahu/Jupiter 1999-03-29 05:49:29.
- **PyJHora `_vimsottari_test_4`** = PVR book Ex.54. Inputs: 1946-10-16 12:58
  IST, 20°30′N 85°50′E. Published: Mercury MD 1991-05-29 08:54:59 →
  2008-05-28 17:30:47. The test notes that the book misnames the start dasa.
- **AstroSage, Mahatma Gandhi.** Inputs: 1869-10-02 08:36:19, Porbandar.
  Published: Moon 28°16′51″ Cancer (Ashlesha 4), balance Mercury 2y 2m 9d. MDs
  end 12/12/71 (Mercury), 12/12/78 (Ketu), 12/12/98 (Venus), 12/12/04, 12/12/14,
  12/12/21, 12/12/39, 12/12/55, 12/12/74. Source:
  https://www.astrosage.com/celebrity-horoscope/mahatma-gandhi-birth-chart.asp.
  These are calendar y/m/d arithmetic, so use a 1-day tolerance.

The engine's existing `balanceYears` formula is correct. It inherits the §1
ayanamsa error.

---

## 6. Item 5 — the lunisolar calendar

All of this is computable **from the instant**: new/full-moon instants
(astronomy-engine `SearchMoonPhase`) plus the sidereal Sun at those instants.
Panchangas label *civil days* by the value at local sunrise, so on a transition
day an instant-based value can differ from a printed panchanga.
**Label every output "tātkālika (instant-based)".** The sunrise-day label is
NEEDS-LOCATION.

### 6.1 Masa — SHIP-LABELLED

**Sources:**
- Chatterjee, "Indian Calendars" (Cambridge, doi 10.1017/S0252921100105901).
- Reingold & Dershowitz `calendar.l` `hindu-lunar-from-fixed`
  (https://raw.githubusercontent.com/EdReingold/calendar-code2/main/calendar.l).
- R&D paper https://www.cs.tau.ac.il/~nachum/calendar-book/papers/hindu-paper.pdf.
- Mishra, arXiv:1007.0062.
- Wikipedia "Adhika-masa".
- Drik Adhik Maas page.

**Rule (amānta).** A lunar month runs from new moon to new moon. It takes the
name of the **solar month in which its opening new moon falls**. Solar months
are named one ahead of the rashi: Sun in Mīna = solar Chaitra, Sun in Meṣa =
solar Vaiśākha.

```
S1 = rashi(λ☉_sid at the new moon that opened the month)   // Mesha = 0
S2 = rashi(λ☉_sid at the next new moon)
name   = MASA[(S1 + 1) mod 12]   // MASA[0] = Chaitra … MASA[11] = Phalguna
adhika = (S1 == S2)              // no sankranti inside → adhika, carries the NEXT month's name
kshaya : a month containing two sankrantis; its skipped name simply never appears
```

The phrasing […] is **wrong**.
That confusion comes from solar calendars: Bengali/Odia/Nepali Baisakh is the
solar month starting at Mesha sankranti, while Tamil calls that month Chithirai.

| # | Lunar month | Sun at opening new moon | Sankranti normally inside |
|---|---|---|---|
| 1 | Chaitra | Meena | Mesha |
| 2 | Vaishakha | Mesha | Vrishabha |
| 3 | Jyeshtha | Vrishabha | Mithuna |
| 4 | Ashadha | Mithuna | Karka |
| 5 | Shravana | Karka | Simha |
| 6 | Bhadrapada | Simha | Kanya |
| 7 | Ashvina | Kanya | Tula |
| 8 | Kartika | Tula | Vrishchika |
| 9 | Margashirsha | Vrishchika | Dhanu |
| 10 | Pausha | Dhanu | Makara |
| 11 | Magha | Makara | Kumbha |
| 12 | Phalguna | Kumbha | Meena |

**Pūrṇimānta.** Shukla paksha has the same name in both systems. In Krishna
paksha (tithi ≥ 16) the purnimanta name is the **next** amanta month's name,
with the adhika flag taken from the current amanta month (R&D
`hindu-fullmoon-from-fixed`). The adhika month therefore occupies the same dates
in both systems, and the nija month splits around it. **Emit both names.**

**Regions** (sources disagree in detail):
- Amānta: Gujarat, Maharashtra, Goa, Karnataka, Andhra Pradesh, Telangana; plus
  the solar-calendar states (Tamil Nadu, Kerala, Bengal, Assam, Tripura) for
  lunar religious dates.
- Pūrṇimānta: Nepal and most of India north of the Vindhyas (Bihar, UP, MP,
  Rajasthan, Punjab, Haryana, HP, J&K, Jharkhand, Chhattisgarh, Uttarakhand,
  Odisha).
- Drik FAQ: https://www.drikpanchang.com/faq/faq-ans8.html.

**Positions:** modern panchangas use **true (drik)** Sun and Moon (R&D, Mishra,
Drik). The old Surya Siddhanta mean-motion month is a different, historical
system. Do not mix the two.

**Kshaya** last happened in 1963–64 and 1982–83. The next is expected for Pausha
in January 2124, per Wikipedia citing Drik. Each kshaya comes with two adhika
months.

**Adhika test vectors:**
- 2023 Adhika Shravana, 18 Jul – 16 Aug. Drik 15/08/2023 shows […].
- 2026 Adhika Jyeshtha, 17 May – 15 Jun. Drik 01/06/2026 shows "Jyeshtha
  (Adhik)" in both systems.
- 2029 Adhika Chaitra, 16 Mar – 13 Apr. Drik 20/03/2029 shows "Chaitra (Adhik)".
- Also 2020 Adhika Ashvina, 18 Sep – 16 Oct.

**Non-adhika month vectors:**
- Drik 19/10/2026: Ashwina / Ashwina.
- Drik 22/03/2012 (US): Purnimanta Chaitra / Amanta Phalguna.
- Prokerala 01/01/2000: Agrahayana / Pausa.
- Prokerala 15/06/1990: Jyeshta / Ashadha.
- Prokerala 14/01/2010: Pausa / Magha.

### 6.2 The 60 samvatsaras

Indices agreed by Wikipedia "Samvatsara", Sewell & Dikshit's tables, Mishra and
hindupad. 1-based, Prabhava = 1:

| # | Name | # | Name | # | Name | # | Name |
|---|---|---|---|---|---|---|---|
| 1 | Prabhava | 16 | Chitrabhanu | 31 | Hevilambi | 46 | Paridhavi |
| 2 | Vibhava | 17 | Svabhanu | 32 | Vilambi | 47 | Pramadi |
| 3 | Shukla | 18 | Tarana | 33 | Vikari | 48 | Ananda |
| 4 | Pramoda | 19 | Parthiva | 34 | Sharvari | 49 | Rakshasa |
| 5 | Prajapati | 20 | Vyaya | 35 | Plava | 50 | Nala (Anala) |
| 6 | Angirasa | 21 | Sarvajit | 36 | Shubhakrit | 51 | Pingala |
| 7 | Shrimukha | 22 | Sarvadhari | 37 | Shobhakrit | 52 | Kalayukta |
| 8 | Bhava | 23 | Virodhi | 38 | Krodhi | 53 | Siddharthi |
| 9 | Yuva | 24 | Vikriti | 39 | Vishvavasu | 54 | Raudra |
| 10 | Dhatri | 25 | Khara | 40 | Parabhava | 55 | Durmati |
| 11 | Ishvara | 26 | Nandana | 41 | Plavanga | 56 | Dundubhi |
| 12 | Bahudhanya | 27 | Vijaya | 42 | Kilaka | 57 | Rudhirodgari |
| 13 | Pramathi | 28 | Jaya | 43 | Saumya | 58 | Raktakshi |
| 14 | Vikrama | 29 | Manmatha | 44 | Sadharana | 59 | Krodhana |
| 15 | Vrisha | 30 | Durmukhi | 45 | Virodhakrit | 60 | Akshaya |

**Spelling variants:**
- Pramoda = Pramodūta
- Svabhanu = Subhanu
- Nala = Anala
- Shobhakrit = Shobhana (Prokerala)
- Krodhana = Manyu
- Akshaya = Kshaya

**Southern (Deccan) cycle — SHIP-LABELLED.** Sewell Art.62: […] Drik and Prokerala print **elapsed** Shaka
years, so in their numbering:

```
southernIndex = ((ShakaElapsed + 12 − 1) mod 60) + 1
```

The formula reproduces every published pair:

| Shaka | Name | Source |
|---|---|---|
| 1912 | Pramoda | Prokerala 1990-06-15 |
| 1921 | Pramathi | Prokerala 2000-01-01 |
| 1931 | Virodhi | Prokerala 2010-01-14 |
| 1933 | Khara | Drik / Prokerala 2012 |
| 1943 | Plava | Prokerala 2021-04-13 |
| 1945 | Shobhakrit | Drik 2023 |
| 1948 | Parabhava | Drik 2026-10-19 |

Year start is an instant and must be labelled:
- **Telugu/Kannada/Marathi:** Chaitra Shukla Pratipada (Ugadi / Gudi Padwa).
- **Tamil:** Mesha sankranti (solar).

**Northern (Bārhaspatya / Jovian) cycle — SHIP-LABELLED.** This is Sewell &
Dikshit Art.59c (Surya Siddhanta with bīja, valid after about 1500 CE):
https://en.wikisource.org/wiki/Page:Sewell_Dikshit_The_Indian_Calendar_(1896)_proc.djvu/52

```
k   = expired Kali years at the Mesha sankranti of the solar year in question
q   = floor((117·k − 60) / 10000) ;  rem = (117·k − 60) mod 10000
N   = ((k + 27 + q − 1) mod 60) + 1          // samvatsara current AT that Mesha sankranti
N ends at  MeshaSankranti + (10000 − rem)·361/10000 days + 15 palas (6 min);
then N+1 runs one Bārhaspatya year (361.026721 days, Art.54).
Two names beginning in one solar year → the first is expunged (kṣaya).
```

**Worked check** (arithmetic on Sewell's formula; the input and the output are
both Drik's):
- Inputs: Mesha sankranti 2026-04-14 09:39 IST, k = 5127.
- Result: N = 53 = Siddharthi, ending at +7.256 d + 6 min = **21 Apr 2026 15:54**.
- Drik prints […].

The same rule gives Nala ending about 4 May 2023 13:30 (Drik: 01:33 PM). For 2028
it gives Durmati **expunged**: Drik labels VS 2085 as Dundubhi.

**Drik's Vikram-year name** = the samvatsara current at Mesha sankranti
(Sewell Art.55). The **samvatsara current at the instant** is a second,
distinct output.

| VS (Drik) | Name | Jovian change shown on Drik (IST) |
|---|---|---|
| 2080 | Nala | Nala → Pingala 4 May 2023 13:33 |
| 2081 | Pingala | → Kalayukta 29 Apr 2024 14:14 |
| 2082 | Kalayukta | → Siddharthi 25 Apr 2025 15:07 |
| 2083 | Siddharthi | → Raudra 21 Apr 2026 15:53 |
| 2084 | Raudra | → Durmati 17 Apr 2027 16:25 |
| 2085 | Dundubhi | Durmati ends 12 Apr 2028 17:04 (expunged) |

**Contested — label it.**
- Hindi press (Amar Ujala, AajTak) names VS 2083 **"Raudra"**, one ahead of Drik.
  Apparently it names the samvatsara that *begins during* the year.
- Wikipedia's table aligns VS 2083 with Parabhava, which is the southern name.
- Sewell 59a/59b and the R&D Ārya mean formula also land one ahead.

Ship Drik / Sewell-59c as primary and state the alternative. The northern-minus-
southern gap is 13 today (Siddharthi 53 vs Parabhava 40) and grows to 14 after
the 2028 expunction.

### 6.3 Year numbers — SHIP-LABELLED

All Drik numbers are **elapsed (gata)** years (R&D Table 2; PyJHora
`saka = kali − 3179; vikrama = saka + 135`):

```
Shaka   : increments at the instant the year's first Chaitra (adhika or nija) begins, i.e. the
          new moon with the Sun in Meena preceding Mesha sankranti. Shaka = CE − 78 after it, CE − 79 before.
Vikram  (Chaitrādi, North) = Shaka + 135
Gujarati VS (Kārtikādi, amānta) = Vikram − 1 from Chaitra start until Kartika Shukla Pratipada; = Vikram after
Kali    = Shaka + 3179
```

**Published:**

| Date | Vikram | Shaka | Gujarati | Kali | Source |
|---|---|---|---|---|---|
| 2023-08-15 | 2080 | 1945 | 2079 | — | Drik |
| 2026-10-19 | 2083 | 1948 | 2082 | 5127 | Drik |
| 2012-03-22 | 2069 | 1933 | 2068 | — | Drik (US) |
| 2000-01-01 | 2056 | 1921 | — | — | Prokerala |

On 2012-03-22 the US page shows VS already 2069 while Shaka is still 1933. That
is a day-boundary artefact of sunrise labelling, and exactly why instant-based
values must say so.

Drik "Kali Ahargana" 1871706 days (2023-08-15) and 1872867 days (2026-10-19)
equal R&D `hindu-day-count`. These are useful day-count vectors.

The Indian National Calendar (Saka, Chaitra 1 = 22 March) is a separate civil
calendar. Do not conflate it.

### 6.4 Ritu — SHIP-LABELLED (emit both)

| Ritu | Vedic (Drik "Vedic Ritu") = amanta months | Drik "Drik Ritu" = tropical Sun |
|---|---|---|
| Vasanta | Chaitra + Vaishakha | 330°–30° |
| Grishma | Jyeshtha + Ashadha | 30°–90° |
| Varsha | Shravana + Bhadrapada | 90°–150° |
| Sharad | Ashvina + Kartika | 150°–210° |
| Hemanta | Margashirsha + Pausha | 210°–270° |
| Shishira | Magha + Phalguna | 270°–330° |

How these columns were established:
- **Vedic column:** an adhika month takes its name's ritu. The lunar-month rule
  is PyJHora `ritu = (maasa_index−1)//2` and Wikipedia "Ritu". Drik's use of it
  is inferred from its daily pages: 16 Mar 2026 (amanta Phalguna) shows Vedic
  "Shishir", and 25 Mar 2026 (Chaitra) shows "Vasant". Both have the Sun in
  Meena, which rules out a sidereal-sign rule.
- **Drik column:** taken from Drik's 2026 tropical season table
  (https://www.drikpanchang.com/seasons/season-tropical-timings.html?year=2026).
  Vasanta begins 18 Feb 21:20 and Shishira 22 Dec 02:19.
- **A third convention** (R&D) pairs sidereal solar signs: Mīna + Meṣa =
  Vasanta, and so on. Name it if offered.

**Published vectors:**
- 22/03/2012: Drik Vasant / Vedic Shishir.
- 01/01/2000: Shishir / Hemant (Prokerala).
- 14/01/2010: Shishir / Hemant.
- 19/10/2026: Sharad / Sharad.

### 6.5 Ayana — SHIP-LABELLED (emit both)

- **Drik Ayana (tropical):** Uttarayana while the tropical Sun is in 270°→90°.
- **Vedic Ayana (sidereal):** Uttarayana from Makara sankranti to Karka
  sankranti.
- Source: Wikipedia "Uttarayana".

Drik vectors:
- 1 Jan 2026: Drik Uttarayana / Vedic Dakshinayana.
- 1 Jul 2026: Drik Dakshinayana / Vedic Uttarayana.
- 22/03/2012: both Uttarayana.
- 19/10/2026: both Dakshinayana.

Prokerala's "Ayana"/"V. Ayana" labels appear to be swapped relative to Drik's.
Do not use them as vectors.

---

## 7. Item 6 — location-bound items (PRIVATE path only) — NEEDS-LOCATION

| Item | Needs | Algorithm | Conventions to label |
|---|---|---|---|
| **Lagna** (sidereal ascendant) | lat, lon (UT instant) | GMST (Meeus ch.12) → LST = GMST + east lon → RAMC; ε true obliquity; `Asc = atan2(cos RAMC, −(sin RAMC·cos ε + tan φ·sin ε))`, then minus ayanamsa. Check: RAMC = 0, φ = 0 gives 90°. The sign-flipped form found online returns the descendant. | above about \|φ\| > 66.5° the Asc can jump; Swiss Ephemeris keeps the Asc in the eastern hemisphere |
| **Bhavas** | lagna | **whole-sign = Parashari default** (PVR: […]); bhava-chalit = equal houses with the lagna as *madhya* (sandhis at ±15°); Sripati = Porphyry trisection used as madhyas (B.V. Raman); Placidus (KP) | system and lagna-as-start vs lagna-as-middle (JHora offers both) |
| Chandra-/Surya-lagna houses | none | whole-sign from the Moon's / Sun's sign | SHIP (location-free) |
| **Sunrise** | lat, lon (optional elevation) | solar altitude h0 at rise | **Drik default: upper limb + refraction, h0 = −0.833°** ([…], https://www.drikpanchang.com/panchang/sunrise/panchang-sunrise.html); classical "Hindu sunrise" is the disc centre without refraction, h0 = 0° (Drik's older FAQ; JHora option 1). The two differ by about 1–5 min. |
| **Vara** | sunrise | weekday runs sunrise to sunrise; a birth before local sunrise belongs to the previous vara | — |
| **Udaya tithi / nakshatra** | sunrise | the value prevailing at local sunrise names the civil day; kshaya/vriddhi tithis follow | distinct from the tātkālika (birth-instant) tithi already shipped |
| **Hora lord** | sunrise, sunset | first hora = vara lord, then the sequence Sun → Venus → Mercury → Moon → Saturn → Jupiter → Mars | **Drik: unequal** (day/12, night/12; checked against Drik's 19 Oct 2026 Delhi table); PVR / JHora: **equal** 24 parts of the sunrise-to-sunrise day |
| **Rahu kalam / Yamaganda / Gulika kalam** | sunrise, sunset | daytime ÷ 8, part numbers below | — |
| Gulika / Mandi (upagraha) | sunrise, sunset, lagna | lagna rising at the start of Saturn's part (BPHS 3.66–69); at night counted from the 5th weekday lord | start / middle / end of the part (JHora option); Mandi = Gulika is disputed |
| Ishta kala | sunrise | (birth − sunrise) in ghatis (1 ghati = 24 min) | — |
| Lagna gandanta, house-based paya, Ashtottari eligibility, day/night birth | lagna or sunset | see §8 | — |

**Daytime eighths.** Rahu kalam never falls in part 1. Gulika and Yamaganda are
the parts of Saturn and Jupiter counted from the vara lord.

| Vara | Rahu | Yamaganda | Gulika |
|---|---|---|---|
| Sun | 8 | 5 | 7 |
| Mon | 2 | 4 | 6 |
| Tue | 7 | 3 | 5 |
| Wed | 5 | 2 | 4 |
| Thu | 6 | 1 | 3 |
| Fri | 4 | 7 | 2 |
| Sat | 3 | 6 | 1 |

**Published location vectors (Drik, New Delhi, IST):**

| Field | 2023-08-15 | 2026-10-19 |
|---|---|---|
| Sunrise / sunset | 05:50 / 19:01 | 06:24 / 17:48 |
| Dinamana | 13h 10m 53s | 11h 23m 26s |
| Rahu kalam | 15:43–17:22 | 07:50–09:15 |
| Gulika | 12:25–14:04 | 13:31–14:57 |
| Yamaganda | 09:08–10:47 | 10:40–12:06 |

The 2023-08-15 page is Wayback snapshot `20260515164316id_`, cross-checked
against snapshot `20250321164218`.

**US-location Drik vectors** for 18/07/2023 (Durham NC, San Francisco),
22/03/2012 (Fairfield CT) and 19/10/2026 (San Francisco) carry full sunrise,
Rahu kalam, Gulika and Yamaganda values. They are in the research pass's
archive list.

**Drik Lagna vectors:**
- 24°03′14.33″ Kumbha (Delhi, geoname 1273294, 1996-12-10 12:29 IST).
- 12°36′19.41″ Kumbha (New Delhi, 2026-10-19 15:22:50 IST).

Take the coordinates from the GeoNames records for those ids before asserting.

**Do not mix sources:** Prokerala's sunrise differs from Drik's by about 4 min
(a different definition). Never cross-assert their sunrises.

---

## 8. Item 7 — other deterministic elements

| Element | Verdict | Content / rule | Sources |
|---|---|---|---|
| Rashi lords | SHIP | Ar Mars, Ta Venus, Ge Mercury, Cn Moon, Le Sun, Vi Mercury, Li Venus, Sc Mars, Sg Jupiter, Cp Saturn, Aq Saturn, Pi Jupiter; the nodes own none | jagannathhora.com/signs; rppandey.com |
| Exaltation / debilitation | SHIP | Sun Ar 10°, Moon Ta 3°, Mars Cp 28°, Mercury Vi 15°, Jupiter Cn 5°, Venus Pi 27°, Saturn Li 20°; debilitation is the 7th sign at the same degree | BPHS 3.49–54 (Santhanam) |
| Moolatrikona | SHIP-LABELLED | Sun Le 0–20, Moon Ta 3–30 (some 4–30), Mars Ar 0–12, Mercury Vi 15–20 (some 16–20), Jupiter Sg 0–10, Venus Li 0–15, Saturn Aq 0–20 | BPHS ch.3; parashara.net |
| Own signs | SHIP | as rashi lords | — |
| Rahu/Ketu dignity | DO-NOT-SHIP | five schools (BPHS ch.47 reading Ta/Sc; Sanjay Rath Ge/Sg; K.N. Rao; Saptarishi Nadi; Jatakalankaram) | honestastrologer.com, madhivanan.in |
| Natural friendship | SHIP | table below; temporary (tātkālika) and compound (pañcadhā) friendship need only planet signs, so they are also location-free | BPHS 3.55; astrocalc.in; vicdicara |
| Vashya (Moon rashi) | SHIP-LABELLED | Chatushpada Ar, Ta, Sg 15–30, Cp 0–15; Manava Ge, Vi, Li, Sg 0–15, Aq; Jalachara Cn, Pi, Cp 15–30; Vanachara Le; Keeta Sc | variants: Cn also as Keeta; Aq placement |
| Paya | nakshatra form SHIP-LABELLED / house form NEEDS-LOCATION | nakshatra form: Gold Revati–Bharani, Iron Krittika–Mrigashira, Silver Ardra–Anuradha, Copper Jyeshtha–U.Bhadrapada. House form (Moon's house from the lagna): 1/6/11 Gold, 2/5/9 Silver, 3/7/10 Copper, 4/8/12 Iron | groupings vary |
| Yogini dasha | SHIP-LABELLED | Mangala 1 (Moon), Pingala 2 (Sun), Dhanya 3 (Jupiter), Bhramari 4 (Mars), Bhadrika 5 (Mercury), Ulka 6 (Saturn), Siddha 7 (Venus), Sankata 8 (Rahu), Σ 36; start = (nakshatra# + 3) mod 8 (0 = Sankata); balance as Vimshottari. Worked example: Moon Sc 10° → Anuradha → Bhramari, 24 months remaining | myzodiaq.in; vedicastro.com; desiutils.in |
| Ashtottari dasha | periods SHIP-LABELLED; eligibility NEEDS-LOCATION | Sun 6, Moon 15, Mars 8, Mercury 17, Saturn 10, Jupiter 19, Rahu 12, Venus 21 (Σ 108); groups counted from Ardra over 28 stars incl. Abhijit. The Jupiter/Rahu/Venus group rows are not yet confirmed against BPHS 48 text. Eligibility (Rahu vs lagna lord; day/night × paksha) is disputed and location-bound. | BPHS 48.17/48.23; satyori.com |
| Combustion (asta) | SHIP-LABELLED | distance from the Sun ≤ Moon 12°, Mars 17°, Mercury 14° (12° retrograde), Jupiter 11°, Venus 10° (8° retrograde), Saturn 15°; these are Surya Siddhanta 9.6–9 *kālāṃśas*, applied by software as longitude separation | Burgess SS (wisdomlib); variants Lalla / Aryabhata II |
| Graha yuddha | SHIP-LABELLED | two of Mars, Mercury, Jupiter, Venus, Saturn within 1° (same sign per the Siddhantas); winner by brightness (SS 7.20–21) vs most northerly (Uttara Kalamrita) | edithhathaway.com; tonylouis |
| Gandanta | SHIP-LABELLED | water/fire junctions at 120°, 240°, 360° sidereal; width one pada each side (wide) vs 48′ (Komilla Sutton) vs about 26′ (2 ghatis of Moon motion); tithi gandanta as a time window | komilla.com; parasara.net |
| Panchaka | SHIP (window) / NEEDS-LOCATION (sub-type) | Moon sidereal 300°–360°; the Rog/Raj/Agni/Mrityu/Chor sub-type follows the starting vara, which is sunrise-bound | nakshatrica.com |
| Anandadi yoga | NEEDS-LOCATION | 28 yogas from vara + 28-star nakshatra; names 1–19 single-sourced | astroswami.in |

**Natural friendship (BPHS 3.55):**

| Planet | Friends | Neutral | Enemies |
|---|---|---|---|
| Sun | Moon, Mars, Jupiter | Mercury | Venus, Saturn |
| Moon | Sun, Mercury | Mars, Jupiter, Venus, Saturn | — |
| Mars | Sun, Moon, Jupiter | Venus, Saturn | Mercury |
| Mercury | Sun, Venus | Mars, Jupiter, Saturn | Moon |
| Jupiter | Sun, Moon, Mars | Saturn | Mercury, Venus |
| Venus | Mercury, Saturn | Mars, Jupiter | Sun, Moon |
| Saturn | Mercury, Venus | Jupiter | Sun, Moon, Mars |

**Out of scope here.** Ashtakavarga, Shadbala, special lagnas, Arudhas and
Jaimini karakas all need the lagna or bhavas, and therefore the private path.
Chara karakas are location-free, but they carry their own 7- vs 8-karaka
dispute; not researched.

---

## 9. Audit of the current engine

| Element in `jyotisha.js` | Status |
|---|---|
| Lahiri anchor 24°07′47″ @2026-01-01 | **Wrong by −5′26″**; slope fine (§1). Provenance text and many-skies.md §2.3 repeat it. |
| Nakshatra / pada / rashi / sidereal-Sun formulas | Correct; inherit the anchor error |
| Tithi (instant, ayanamsa-free) | Correct; label it tātkālika |
| Yoga | Correct formula (the ayanamsa-does-not-cancel trap is handled); add names (§4.4) |
| Karana | Correct, verified (§4.5) |
| Civil vara | Correctly labelled; sunrise vara stays omitted |
| Vimshottari seed | Correct formula; full timeline missing (§5) |
| `Dhanishta` vs namakarana `Dhanishtha` | Cosmetic inconsistency |
| Existing tests (`test/unit/skies-engine.test.js`) | No published-value assertion for nakshatra, yoga or karana; they would not have caught §1 |

The Nāmakaraṇa syllable is derived from the pada, so some beings already shown a
pada palette may have been shown the neighbouring pada's syllable. skies.json
lives outside genesisHash and can be recomputed. Whether to re-derive and
surface corrections is **Founder's call**; this record takes no action.

---

## 10. Remaining uncertainty

1. **Lahiri realisation.** Drik sits about +22″ above Swiss Ephemeris/IAE mean,
   and Prokerala about +24″ above Drik. Neither offset is explained. Pick
   "IAE/SE mean" and label it; test against Drik with ≥30″ tolerance.
2. **Dasha-year length.** Drik's convention is unpublished. JHora's current
   default is attested only by PVR's own statement (true sidereal) against one
   weaker site (365.25).
3. **Northern samvatsara year-name.** Drik / Sewell-59c say Siddharthi for VS
   2083; the Hindi press says Raudra. The press convention's rule is not
   documented in any source found.
4. **Gujarati samvatsara names on Drik** follow an undocumented pattern
   (Gujarati N = Drik northern name of VS N−1). Do not ship until explained.
5. **Single- or two-source cells.** Ashtottari Jupiter/Rahu/Venus groups;
   Anandadi names 1–19; nakshatra 5-element; the Meeus ch.47 (lunar-theory)
   node polynomial, which was not used (the ch.22 form is used and verified).
6. **Varna** needs a ruling on both correctness (three mappings) and values
   (caste labels on a being).
7. **Drik date queries are captcha-blocked live.** Drik vectors for 2000-01-01,
   1990-06-15 and 2010-01-14 came from Prokerala instead. Prokerala agrees with
   Drik to within 1 min on tithi, nakshatra and yoga ends where both exist.
8. **True node** is computed by our osculating r×v method. It matches Drik's
   Spashta Rahu within 15″ on two dates [our comparison]. Confirm on all four
   Drik instants before shipping it as the secondary output.

---

## Appendix A — Panchanga test-vector compendium (published values only)

**Drik, New Delhi, IST.** 2023-08-15 is Wayback snapshot `20260515164316id_`;
2026-10-19 is the live page.

| Field | 2023-08-15 (Tue) | 2026-10-19 (Mon) |
|---|---|---|
| Tithi | Chaturdashi (K) until 12:42, then Amavasya | Ashtami (S) until 10:51, then Navami |
| Nakshatra | Pushya until 13:59, then Ashlesha | Uttara Ashadha until 15:38, then Shravana |
| Moon pada steps | Pushya-3 until 07:15; Pushya-4 until 13:59; Ashlesha-1 until 20:43; Ashlesha-2 until 03:27 (+1) | UAsh-3 until 08:58; UAsh-4 until 15:38; Shravana-1 until 22:17; Shravana-2 until 04:54 (+1) |
| Yoga | Vyatipata until 17:33, then Variyana | Dhriti until 00:35 (+1), then Shula |
| Karana | Shakuni until 12:42; Chatushpada until 01:54 (+1); Nagava | Bava until 10:51; Balava until 23:54; Kaulava |
| Moon / Sun rashi | Karka / Karka | Makara / Tula |
| Surya nakshatra-pada | Ashlesha-4 | Chitra-3 |
| Months (purnimanta / amanta) | Shravana (Adhik) / Shravana (Adhik) | Ashwina / Ashwina |
| Vikram / Shaka / Gujarati | 2080 Nala / 1945 Shobhakrit / 2079 Aananda | 2083 Siddharthi / 1948 Parabhava / 2082 Pingala |
| Drik / Vedic ritu | Varsha / Varsha | Sharad / Sharad |
| Drik / Vedic ayana | Dakshinayana / Dakshinayana | Dakshinayana / Dakshinayana |
| Lahiri (Drik) | 24.193754° | 24.238165° |
| Kali Ahargana | 1871706 days | 1872867 days |

**Prokerala, New Delhi, IST** (`prokerala.com/astrology/panchang/<yyyy-month-dd>.html?loc=1261481`):

| Date | Tithi end | Nakshatra end | Yoga end | Karana sequence |
|---|---|---|---|---|
| 2000-01-01 | K-Dashami until 11:03 | Swati until 18:33 | Sukarman until 12:38 | Vishti until 11:03, then Bava, Balava |
| 1990-06-15 | K-Saptami until 22:50 | Shatabhisha until 14:33 | Priti until 01:13 (+1) | Vishti until 11:13, then Bava until 22:50, then Balava |
| 2010-01-14 | K-Chaturdashi until 10:12 | Purva Ashadha until 03:52 (+1) | Vyaghata until 20:27 | Shakuni until 10:12, then Chatushpada until 23:25, then Naga |
| 2021-04-13 | S-Pratipada until 10:17 | Ashwini until 14:19 | Vishkambha until 15:16 | Bava until 10:17, then Balava until 23:31, then Kaulava |
| 2012-03-22 | Amavasya until 20:07 | Purva Bhadrapada until 10:17 | Shukla until 02:08 (+1) | Chatushpada until 07:19, then Naga until 20:07, then Kimstughna |
| 2023-07-18 | S-Pratipada until 02:10 (+1) | Pushya until 07:58 (+1) | Harshana until 09:36, then Vajra | Kimstughna until 13:04, then Bava, Balava |

**Prokerala year names for these dates:**
- 2000: VS 2056 Nandana / Shaka 1921 Pramathi.
- 1990: VS 2047 Subhanu / Shaka 1912 Pramoda.
- 2010: VS 2066 Shubhakrit / Shaka 1931 Virodhi.
- 2021: VS 2078 Ananda / Shaka 1943 Plava.

## Appendix B — principal sources

- Swiss Ephemeris docs (ayanamsa definitions, App. E IAE values): https://www.astro.com/swisseph/swisseph.htm
- BPHS, R. Santhanam translation: https://archive.org/download/BPHSEnglish/BPHS%20-%201%20RSanthanam.pdf
- P.V.R. Narasimha Rao, *Vedic Astrology: An Integrated Approach*: https://www.vedicastrologer.org/articles/vedic_astro_textbook.pdf ; JHora features: https://www.vedicastrologer.org/jh/features.htm
- PyJHora source + tests: https://github.com/naturalstupid/PyJHora
- VedAstro source: https://github.com/VedAstro/VedAstro
- jyotishyamitra: https://github.com/VicharaVandana/jyotishyamitra
- Maitreya8: https://github.com/martin-pe/maitreya8 ; Saravali docs: https://saravali.github.io/astrology/
- Sewell & Dikshit, *The Indian Calendar* (1896), Wikisource pp. 50–53
- Reingold & Dershowitz code: https://raw.githubusercontent.com/EdReingold/calendar-code2/main/calendar.l ; paper: https://www.cs.tau.ac.il/~nachum/calendar-book/papers/hindu-paper.pdf
- Chatterjee, "Indian Calendars", Cambridge (doi 10.1017/S0252921100105901); Mishra, […], arXiv:1007.0062
- Meeus, *Astronomical Algorithms* ch.22 (via NREL SPA TP-560-34302: https://docs.nlr.gov/docs/fy08osti/34302.pdf)
- Wikipedia raw wikitext: Nakshatra, Nityayoga, Karaṇa (pañcāṅga), Tithi, Hindu calendar, Samvatsara, Adhika-masa, Ritu, Uttarayana, Dasha (astrology), Abhijit (nakshatra)
- Drik Panchang (day panchang, sidereal positions, sunrise, seasons, adhik maas, FAQ); Prokerala panchang + sidereal positions
