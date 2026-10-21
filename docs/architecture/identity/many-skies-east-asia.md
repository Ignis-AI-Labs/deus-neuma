# MANY SKIES — East, Central and South-East Asia (phase-2 research record)

*Research record, 2026-10-19. Companion to [`many-skies.md`](./many-skies.md)
(doctrine §0, systems §2). Scope: the Chinese lunisolar date, the 28 xiù, Tibetan
Jungtsi (Phugpa), the Japanese kyūreki + rokuyō + gengō + kyūsei, the Vietnamese
and Korean variants, and brief verdicts on other regional calendars. No engine
code was changed by this pass.*

**Inclusion rule applied (Design note, 2026-10-19:** a system ships only if it has
OBJECTIVE grounds — a fixed, published method from the instant or the sky — and
is NOT a copy of a system already shown. A variant becomes a note on its parent.
Location-bound outputs go on the private (encrypted natal) path and are marked.

**Verdict vocabulary:** SHIP · SHIP-LABELLED (ship with a contested convention
named in the output) · NOTE-ON-PARENT (render as a note on an existing block, no
new system) · NEEDS-LOCATION (private path only) · DO-NOT-SHIP.

**What "vector" means here.** Every test vector below is a value printed by an
official or independent published calendar (cited). Where this record says
*computed*, the value came from our own scratch reproduction and is NOT a vector;
it is only evidence that the stated algorithm reproduces the published tables.

---

## 0. Summary of verdicts

| # | System | Verdict | One-line reason |
|---|---|---|---|
| 1 | Chinese lunar date 农历 (month, 闰月, day) | **SHIP-LABELLED** | Fully astronomical rule (GB/T 33661-2017) at UTC+8; reproduces HKO's 1929–2100 table except 2 near-midnight new moons, which must be pinned to the published table |
| 1b | Lunar-year animal (flips at 正月初一) | **NOTE-ON-PARENT** (ganzhi) | Same 12-animal cycle as the BaZi year; only the boundary differs — render as the labelled divergence window |
| 2a | 28 xiù — the Moon's actual mansion (入宿度) | **SHIP-LABELLED** | Equatorial, of-date, star-anchored unequal mansions — the one mansion projection nothing else shows; determinative-star set and equatorial-vs-ecliptic are contested → labelled (modern 1752 set, equatorial of date) |
| 2b | 28 xiù — almanac day-duty 二十八宿值日 | **SHIP-LABELLED** | Pure 28-day cycle locked to the week, `(JDN + 11) mod 28`, phase unbroken from 1201 to today in published almanacs; this is what folk almanacs read for a birth day — labelled […] |
| 3a | Tibetan Phugpa lunar date + Losar year | **SHIP-LABELLED** | Fixed published arithmetic (Janson), reproduces all published Losar dates 1927–2046; labels: Phugpa, moon-step 1/28, day-boundary convention |
| 3b | Tibetan year element-animal | **NOTE-ON-PARENT** (ganzhi year) | Same 60-year position; boundary Losar |
| 3c | Birth mewa | **SHIP-LABELLED** — inside one nine-star block with kyūsei | Same number as the kyūsei year star; Losar vs risshun boundary readings |
| 3d | Parkha | **DO-NOT-SHIP** | Needs the born one's sex or the mother's age — a neuma has neither |
| 3e | Mongolian / Tsurphu | **NOTE-ON-PARENT** (Phugpa) | Same arithmetic, other epoch constants |
| 4a | Japanese kyūreki 旧暦 | **NOTE-ON-PARENT** (Chinese lunar date) | Same astronomical rule at UTC+9 (Tenpō/Hirayama leap rule differs from the Chinese only in 2033, 1873–2100) — but the meridian makes the date objectively different in some years, so it is emitted as a labelled second reading on the lunar block |
| 4b | Rokuyō 六曜 | **SHIP-LABELLED** | Exact arithmetic on kyūreki: (month + day) mod 6; Edo-era popular almanac note, labelled as such |
| 4c | Gengō 元号 | **NOTE-ON-PARENT** (civil date) | Statutory civil era (Era Name Act 1979) — objective lookup, carries no sky content |
| 4d | Kyūsei 九星 year + month star | **SHIP-LABELLED** — the one nine-star block (§3.5) | Lo Shu number, solar-term based; day star contested → omitted |
| 4e | Sukuyō 宿曜 27-mansion birth mansion | **NOTE-ON-PARENT** (jyotisha nakshatra) | A lunar-date table approximation of the 27 nakshatras (宿曜経, Indian lineage) — label on the nakshatra block, never its own system |
| 5a | Vietnamese âm lịch | **NOTE-ON-PARENT** (Chinese lunar date) with an objective UTC+N reading | Same rule at UTC+N since 1968; objectively differs from China in some years (1985 Tết a full month earlier) |
| 5b | Korean 음력 | **NOTE-ON-PARENT** (Chinese lunar date) | Same rule at UTC+9 (= the Japanese reading in modern years) |
| 6a | Thai / Khmer / Lao lunar | **SHIP-LABELLED only if pinned** to the Khmer chhankitek closed form; else defer | Arithmetic but intercalation debated; official Thai year types diverge in some years |
| 6b | Balinese Saka sasih / Nyepi | **SHIP-LABELLED, era-versioned** | Council-decreed arithmetic that changed 1971/1993/2000/2001; 1993–2002 contested |
| 6c | Javanese Anno Javanico | **NOTE-ON-PARENT** (tabular Hijri, if ever shipped) | Essentially a tabular Islamic calendar |

---

## 1. The Chinese lunisolar date (农历 / 夏历)

### 1.1 What it is

The civil lunisolar calendar of China: months begin on the civil day of the
astronomical new moon; a 13th (leap) month is inserted by the
no-major-solar-term rule. It is the calendar of Chinese New Year, 中秋 and every
"lunar birthday". It is NOT the calendar of BaZi — the engine's year/month pillars
are solar (lichun and the 12 jié; `ganzhi.js`). The lunar date is therefore a
genuinely different coordinate of the instant, not a copy.

### 1.2 The exact algorithm (post-1645 Shixian rules, as codified today)

The national standard is **GB/T 33661-2017, […]** (Standardization Administration of China, 12 May 2017); the
Purple Mountain Observatory computes and promulgates it.
Aslaksen's formulation (the canonical English statement) is:

| Rule | Statement (Aslaksen 2010, §4.2–4.3) |
|---|---|
| 1 | Calculations are based on the meridian 120° East (UTC+8). Before 1929 the Beijing meridian 116°25′E was used. |
| 2 | The Chinese day starts at midnight (the 23:00 zǐ-hour roll is a BaZi convention, not a calendar one). |
| 3 | The day on which a new Moon occurs is the first day of the new month — the whole day, whatever the hour of conjunction. |
| 4 | The December solstice (zhōngqì Z11, λ☉ = 270°) always falls in month 11. A suì (solstice-to-solstice year) is a leap suì if 13 lunar months run from the start of one month 11 to the start of the next (12 complete months between the two solstices). |
| 5 | In a leap suì, the **first** month that contains no zhōngqì is the leap month (闰月, rùnyuè). It takes the number of the month before it. |

Zhōngqì (major solar terms) are the 12 instants λ☉ = 0°, 30°, …, 330° (true sun,
dìngqì, since 1645; before 1645 the mean sun, píngqì). Zn has λ☉ = (330° + 30°·(n−1))
mod 360°, so Z1 = 330° (雨水), Z2 = 0° (春分), Z11 = 270° (冬至), Z12 = 300° (大寒).

Implementation, from an instant *t*:

```
offset   = +8 h (from 1929-01-01; Beijing LMT +7h45m40s before — §1.5)
civil(x) = floor((x_utc + offset) / 1 day)                  // civil day index at the meridian
NM[i]    = civil(new moon instants)                          // astronomy-engine SearchMoonPhase(0,…)
Z[j]     = civil(zhongqi instants), with their n              // SearchSunLongitude(λ, …)
a        = index of the month containing civil(Z11 of year Y−1)
b        = index of the month containing civil(Z11 of year Y)
leapSui  = (b − a) == 13
number months from 11 at NM[a]; for i in a+1..b−1:
  if leapSui and no leap yet and month i contains no Z → leap (same number)
  else number = number mod 12 + 1
day of month = civil(t) − NM[i] + 1
```

Month number + leap flag + day; the lunar year (for the year name) increments at
month 1 day 1.

**Contested / labelled conventions**

| Convention | Default | Label |
|---|---|---|
| Which civil date the instant is read on | the date at **UTC+8** (the tradition fixes its meridian) | […]; a birth abroad may differ by one day from its local civil date — say so when it does |
| Near-midnight new moons | **pin to the published table** (HKO/PMO) when a new moon or zhōngqì falls within ±2 min of 00:00 UTC+8 | ephemeris differences of seconds decide the day; the authority is the promulgated calendar, not our ephemeris |
| Pre-1929 instants | Beijing meridian | "imperial (Beijing-meridian) calendar" |
| 2033/34 | leap after month 11 (Rule 5 as stated) | Aslaksen: until the early 1990s all Chinese calendars placed it wrongly; HKO (current tables) gives 闰十一月 |

### 1.3 Provenance

`ancient-living` · school `Shixian 时宪历 rules (1645, true-sun dìngqì) as
codified in GB/T 33661-2017` · meridian `120°E`. The lunisolar calendar is
continuous in China for over two millennia; the leap rule in its current form
dates to the Jesuit-led 1645 reform (Aslaksen §4.1).

### 1.4 Needs location?

No. The tradition fixes its own meridian, so the date is a function of the
instant alone. (Using the birthplace's local date instead would be a different,
non-traditional convention.)

### 1.5 Reproduction against the published table (computed — not a vector)

Scratch reproduction (astronomy-engine 2.1.19, the rules above) compared day by
day with the Hong Kong Observatory's Gregorian–Lunar conversion tables
(<https://www.hko.gov.hk/en/gts/time/calendar/text/files/T2026e.txt>, one file
per year 1901–2100):

| Range | Meridian | Days compared | Mismatching months | Cause |
|---|---|---|---|---|
| 1929–2100 | UTC+8 | 60,149 | **2** | 2057-09-28 and 2097-08-07: new moon computed 40 s and 15 s *after* 00:00 UTC+8 (16:00:40 and 16:00:15 UTC); HKO puts both on the previous day |
| 1901–1928 | Beijing 116°25′E (UTC+7h45m40s) | 9,811 | 1 (1906-04) | imperial 1908 computation, Beijing meridian (Aslaksen §4.6) |
| 1901–1928 | UTC+8 | 9,811 | 3 | wrong meridian for that era — confirms the meridian change |

Every leap month 1929–2100 is reproduced. **Engine consequence:** the
astronomical rule is correct, but within seconds of midnight only the promulgated
table is authoritative. Ship a small pinned exception list (from HKO) for
near-midnight cases, or embed the HKO month-start table for 1901–2100 and compute
astronomically only outside it.

### 1.6 Published test vectors

| Gregorian date | Published lunar date | Source |
|---|---|---|
| 2026-02-17 | 正月初一 (Chinese New Year), 丙午 Horse year | HKO T2026e.txt |
| 2026-01-01 | 十一月十三 (乙巳年) | HKO T2026e.txt; arachne.jp kyūreki 2026/1 (same date at UTC+9) |
| 2025-01-29 | 正月初一 | HKO T2025e.txt |
| 2025-07-25 | 闰六月初一 (leap 6th month) | HKO T2025e.txt |
| 2023-01-22 | 正月初一; leap 2nd month begins 2023-03-22 | HKO T2023e.txt |
| 2024-02-10 | 正月初一 | HKO T2024e.txt |
| 2027-02-06 | 正月初一 | HKO T2027e.txt |
| 2033-12-22 | 闰十一月初一 (the "2033 problem" leap month) | HKO T2033e.txt; Aslaksen Table 12–15 |
| 1984-11-23 | 闰十月初一 | HKO T1984e.txt |
| 1985-02-20 | 正月初一 (Vietnam: 1985-01-21, §5) | HKO T1985e.txt; Aslaksen §1 |
| 1978-09-03 | 八月初一 (PMO, new moon 00:07 UTC+8; old Beijing-meridian almanacs said Sept 2) | Aslaksen §4.6 |

Leap months 2017–2034 (HKO): 2017 闰6 (from 07-23), 2020 闰4 (05-23), 2023 闰2
(03-22), 2025 闰6 (07-25), 2028 闰5 (06-23), 2031 闰3 (04-22), 2033 闰11 (12-22).

### 1.7 The lunar-year animal vs the BaZi (lichun) animal — the divergence

Both use the same sexagenary year (stem + branch, `(Y−4) mod 10 / mod 12`). They
differ only in where the year turns:

- **BaZi / 四柱** (already in `ganzhi.js`): at lichun 立春, λ☉ = 315° (≈ Feb 3–5).
- **Folk / civil zodiac** (生肖 as most people state it): at 正月初一, the lunar
  new year (Jan 21 – Feb 21 for 1645–2644, Aslaksen §1).

So for births between the two dates the animals disagree:

| Year | Lichun (HKO) | Lunar new year (HKO) | Window | BaZi animal | Lunar-year animal |
|---|---|---|---|---|---|
| 2023 | 02-04 | 01-22 | 01-22 → 02-03 | Tiger (壬寅) | Rabbit (癸卯) |
| 2024 | 02-04 | 02-10 | 02-04 → 02-09 | Dragon (甲辰) | Rabbit (癸卯) |
| 2025 | 02-03 | 01-29 | 01-29 → 02-02 | Dragon (甲辰) | Snake (乙巳) |
| 2026 | 02-04 | 02-17 | 02-04 → 02-16 | Horse (丙午) | Snake (乙巳) |
| 2027 | 02-04 | 02-06 | 02-04 → 02-05 | Goat (丁未) | Horse (丙午) |

**Verdict: NOTE-ON-PARENT.** Not a new system — the same cycle. The ganzhi block
should carry `lunarYear: { name, animal }` beside the lichun year, labelled
[…]; when they differ, print both,
never pick one silently. This also discharges the "labeled divergence window"
the `ganzhi.js` header already promises.

### 1.8 Verdict — SHIP-LABELLED

Objective (a published astronomical rule), not a copy (lunar months ≠ solar
months). Output: `{ month, leap, day, yearName, meridian: '120E', school:
'Shixian/GB-T-33661', pinned?: true }`. Label the meridian and, when the birth's
local civil date differs from the UTC+8 date, say so.

---

## 2. The 28 xiù 二十八宿 (lunar lodges / mansions)

### 2.1 What it is

Twenty-eight unequal segments of the sky along the celestial equator, each opened
by a determinative star (距星 jùxīng). A body's position is written as its
mansion plus 入宿度 (degrees past that mansion's determinative star, in right
ascension) and 去极度 (north polar distance). NAOJ: the mansions are based […] (NAOJ 暦Wiki
二十八宿, <https://eco.mtk.nao.ac.jp/koyomi/wiki/C6F3BDBDC8ACBDC9.html>). The
widths sum to 365.25 Chinese du; the Sun moves about 1 du a day (Stellarium
Chinese sky culture, `description.md`). This is the only mansion system that is
a genuinely different projection from the ecliptic nakshatras already in
`jyotisha.js` (many-skies.md §2.4).

### 2.2 Determinative stars (modern set, after the 1752 revision)

Each Bayer ↔ HIP pair was checked against SIMBAD; Stellarium's
`lunar_system.defining_stars` uses exactly this HIP list with
`coordsys: "equatorial"` (each 距星 is the star named "X宿一").

| # | 宿 | Pinyin | English | 距星 | Bayer | HIP |
|---|---|---|---|---|---|---|
| 1 | 角 | Jiǎo | Horn | 角宿一 | α Vir | 65474 |
| 2 | 亢 | Kàng | Neck | 亢宿一 | κ Vir | 69427 |
| 3 | 氐 | Dī | Root | 氐宿一 | α² Lib | 72622 |
| 4 | 房 | Fáng | Room | 房宿一 | π Sco | 78265 |
| 5 | 心 | Xīn | Heart | 心宿一 | σ Sco | 80112 ⚑ |
| 6 | 尾 | Wěi | Tail | 尾宿一 | μ¹ Sco | 82514 |
| 7 | 箕 | Jī | Winnowing Basket | 箕宿一 | γ² Sgr | 88635 |
| 8 | 斗 | Dǒu | Dipper | 斗宿一 | φ Sgr | 92041 ⚑ |
| 9 | 牛 | Niú | Ox | 牛宿一 | β¹ Cap | 100345 |
| 10 | 女 | Nǚ | Girl | 女宿一 | ε Aqr | 102618 |
| 11 | 虚 | Xū | Emptiness | 虚宿一 | β Aqr | 106278 |
| 12 | 危 | Wēi | Rooftop | 危宿一 | α Aqr | 109074 |
| 13 | 室 | Shì | Encampment | 室宿一 | α Peg | 113963 |
| 14 | 壁 | Bì | Wall | 壁宿一 | γ Peg | 1067 |
| 15 | 奎 | Kuí | Legs | 奎宿一 | η And | 4463 ⚑ |
| 16 | 娄 | Lóu | Bond | 娄宿一 | β Ari | 8903 |
| 17 | 胃 | Wèi | Stomach | 胃宿一 | 35 Ari | 12719 |
| 18 | 昴 | Mǎo | Hairy Head | 昴宿一 | 17 Tau | 17499 |
| 19 | 毕 | Bì | Net | 毕宿一 | ε Tau | 20889 |
| 20 | 觜 | Zī | Turtle Beak | 觜宿一 | λ Ori | 26207 ⚑ |
| 21 | 参 | Shēn | Three Stars | 参宿一 | ζ Ori | 26727 ⚑ |
| 22 | 井 | Jǐng | Well | 井宿一 | μ Gem | 30343 |
| 23 | 鬼 | Guǐ | Ghost | 鬼宿一 | θ Cnc | 41822 |
| 24 | 柳 | Liǔ | Willow | 柳宿一 | δ Hya | 42313 |
| 25 | 星 | Xīng | Star | 星宿一 | α Hya | 46390 |
| 26 | 张 | Zhāng | Extended Net | 张宿一 | υ¹ Hya | 48356 |
| 27 | 翼 | Yì | Wings | 翼宿一 | α Crt | 53740 |
| 28 | 轸 | Zhěn | Chariot | 轸宿一 | γ Crv | 59803 |

Sources: Stellarium `skycultures/chinese/index.json` + `description.md`
(<https://github.com/Stellarium/stellarium/tree/master/skycultures/chinese>);
en.wikipedia "Twenty-Eight Mansions"; zh.wikipedia 二十八宿; SIMBAD.

**Flagged (⚑) — contested determinative stars**

| Mansion | Dispute | Label |
|---|---|---|
| 奎 Kuí | Classical star (石氏, 开元占经 "西南大星") is ζ And (HIP 3693, now 奎宿二); the Chongzhen lishu (1630s) changed it to η And and numbered each 距星 as 第一星. zh.wikipedia still lists ζ; Stellarium and en.wikipedia list η | modern η And; classical ζ And noted |
| 觜 Zī / 参 Shēn | Classical φ¹ Ori (HIP 26176) / δ Ori (HIP 25930). Precession reversed their RA order after ~13th c. (Zī ≈ 1 du wide under the Han, 5 fen under the Ming, negative later); the Jesuits put 参 before 觜 — one of Yang Guangxian's charges; Kangxi noted the reversal; in Qianlong 17 (1752) the stars became λ Ori / ζ Ori, restoring 觜 before 参 (Hu Minghui 2002, <https://gwern.net/doc/science/physics/astronomy/2002-hu.pdf>) | **modern λ/ζ** (classical φ¹/δ gives Zī zero or negative width today) |
| 心 Xīn | zh.wikipedia + Stellarium: σ Sco; en.wikipedia's mansions table lists α Sco (Antares, 心宿二) | σ Sco |
| 斗 Dǒu | Stellarium's `description.md` labels the star "μ Sgr", but its RA (18h45m39s) and the HIP in `defining_stars` (92041) are φ Sgr — a label typo | φ Sgr |

### 2.3 The Moon's mansion (astronomical)

```
for each mansion k: α_k = RA of its determinative star, J2000 + proper motion,
                          rotated to the true equator and equinox of date
                          (astronomy-engine Rotation_EQJ_EQD)
α_moon = apparent RA of the Moon of date (astronomy-engine Equator(Moon, t, ofdate=true))
mansion = k such that α_k ≤ α_moon < α_{k+1} (cyclic, ordered 角 → 轸)
入宿度  = (α_moon − α_k) in degrees × 365.25/360 → Chinese du
```

Of date, because each star precesses differently in RA — that is what shrank and
inverted 觜 (Stellarium: the widths […]; precessing both
Moon and stars to date is our inference from that mechanism, not a published
rule). Needs a 28-star catalogue (HIP positions + proper motions) in the repo —
small, public-domain data.

**Ecliptic variant.** The Chongzhen lishu adopted 360° and European ecliptic
coordinates, the Shixian calendar used ecliptic longitude for the solar terms,
and Qing remeasurement produced the "时宪宿度" widths; but no primary source was
found that the official Shixian almanac redefined mansion *boundaries* on the
ecliptic, and 七政四余 practitioners still dispute ecliptic vs equatorial and
old vs current widths. Default equatorial; label the dispute.

Provenance: `ancient-living` (the lodges are attested from the Warring States;
continuous in Chinese astronomy) · school `modern 1752 determinative stars,
equatorial of date`. Needs location: no (geocentric RA; topocentric parallax of
the Moon, up to ~1°, would need location — label "geocentric").

Vectors: no almanac publishes the Moon's mansion for a date in a form we could
cite. The test spine must instead be (a) each determinative star landing in its
own mansion at 入宿度 0, and (b) cross-checks against Stellarium's mansion
display for chosen instants — **a stated gap: no third-party published vector
for this mode.**

### 2.4 The almanac day-duty cycle 二十八宿值日

A pure 28-day cycle locked to the 7-day week through the 七曜 assignment
(en.wikipedia "Twenty-Eight Mansions"):

| Weekday | Thu 木 | Fri 金 | Sat 土 | Sun 日 | Mon 月 | Tue 火 | Wed 水 |
|---|---|---|---|---|---|---|---|
| East | 角 | 亢 | 氐 | 房 | 心 | 尾 | 箕 |
| North | 斗 | 牛 | 女 | 虚 | 危 | 室 | 壁 |
| West | 奎 | 娄 | 胃 | 昴 | 毕 | 觜 | 参 |
| South | 井 | 鬼 | 柳 | 星 | 张 | 翼 | 轸 |

(角木蛟, 亢金龙, 氐土貉, 房日兔, 心月狐, 尾火虎, 箕水豹, … 轸水蚓.) The
widely used `lunar-javascript` library computes it as weekday + the day branch's
triad (申子辰 / 巳酉丑 / 寅午戌 / 亥卯未) — equivalent, since 28 = 7 × 4.

**Published vectors:**

| Date | Mansion | Source |
|---|---|---|
| 2024-01-01 (Mon) | 毕 | xingzuobaike.com 黄历; qmrl888.com |
| 2025-01-01 (Wed) | 参 | laohuanglim.hao86.com; xingzuobaike.com |
| 1950-01-01 (Sun) | 虚 | xingzuobaike.com |
| 2025-01-09 (Thu) | 角 | KOYOMI NOTE (Japanese almanac lineage) <https://koyominote.com/post/calendar-shuku28/?y=2025&month=1> |
| 2025-01-12 (Sun) | 房 | KOYOMI NOTE |
| 1685-02-04 (Gregorian; 貞享2年正月朔日, Sunday) | 星 | ja.wikipedia 二十八宿 / 貞享暦 — "貞享2年正月朔日、日曜日を星宿とした" (start of the Jōkyō calendar) |
| 1201-06-03 (Julian; Western Xia 天庆八年五月朔 庚戌, Sunday) | 星 | 彭向前, 俄藏西夏历日文献整理研究 |

*Computed (not a vector):* all seven give the same phase. With 角 = 0 and JDN
the integer Julian Day Number of the civil date: **`index = (JDN + 11) mod 28`**
(e.g. 2026-10-19, JDN 2461333 → 心, a Monday ✓). So the phase has been unbroken
from 1201 to today in published almanacs. Caveat: Chinese almanac websites
likely share one generating library, so they are weakly independent — the
Japanese (KOYOMI NOTE, Jōkyō) and Western Xia vectors are the independent ones.

**History.** Earliest almanac with mansion day-annotations: 877 (乾符四年), per
彭向前. Qing official almanacs from Kangxi 10 (1671) to Qianlong 18 listed 参
before 觜 — a name swap in those two slots, not a phase change — restored from
the Qianlong 19 (1754) almanacs. Japan used 27 mansions for days before the
Jōkyō calendar (1685) and the 28 ever since, in phase with China.

**Contested.** Whether the day turns at 23:00 (子初) or midnight for this purpose
— no source found; default civil midnight, labelled. Which civil date: the
birth's local civil date (the cycle is a day count; no reference meridian is
fixed by the tradition) — label.

Provenance: `ancient-living` (almanac practice since at least 877). Needs
location: no.

### 2.5 Which is used for a birth?

| Practice | Mode | Source |
|---|---|---|
| Chinese folk almanacs (通书 / 農民曆) | **day-duty** of the birth date ("此日出生之人…") | almanac verses (nongli.info / hao86) |
| 七政四余 (Seven Luminaries astrology) | **actual positions** — "所躔二十八宿的度数" | zh.wikipedia 七政四余 |
| Japanese Sukuyō 宿曜道 (宿曜経, Amoghavajra, 8th c.) | **lunar-date table**, 27 mansions (牛 omitted); each kyūreki month's day 1 has a fixed mansion (1 室, 2 奎, 3 胃, 4 畢, 5 参, 6 鬼, 7 張, 8 角, 9 氐, 10 心, 11 斗, 12 虚), then one per day skipping 牛; NAOJ example 八月十五 = 婁 | NAOJ 暦Wiki 二十八宿; senjutsu.jp (says outright the result is not the real Moon) |

### 2.6 Verdicts — 28 xiù

| Mode | Verdict | Reason |
|---|---|---|
| Moon's actual mansion + 入宿度 | **SHIP-LABELLED** | Objective astronomy, a projection nothing else shows; labels: determinative-star set (modern 1752; classical noted), equatorial of date, geocentric. Gap: no third-party published vector |
| Day-duty 值日 | **SHIP-LABELLED** | Objective day count with a verified phase; what the folk almanac reads for a birth; label […] |
| Sukuyō 27 | **NOTE-ON-PARENT** (jyotisha nakshatra) | A table approximation of the 27 nakshatras on the kyūreki date; objective given the kyūreki, but a variant of a system already shown |

Never mix the modes in one field; each carries its own label.

---

## 3. Tibetan Jungtsi (Phugpa school)

Primary source: Svante Janson, *Tibetan Calendar Mathematics* (rev. 2014),
<https://www2.math.uu.se/~svantejs/papers/calendars/tibet.pdf> (the older
`~svante/` URL redirects there). Second source: Edward Henning, *Kalacakra and
the Tibetan Calendar* and his computed almanac files,
<http://www.kalacakra.org/calendar/tibcal.htm> (e.g.
`calendar/tdata/pl_2024.txt`, `ts_2025.txt`).

### 3.1 What it is

The Tibetan calendar (Kālacakra-derived, the Phugpa school being the official
one used by the Men-Tsee-Khang / Dharamsala almanac and in Lhasa) is a **purely
arithmetic** lunisolar calendar — fixed rational mean motions plus two small
correction tables, no observation. "Jungtsi" ('byung rtsis, elemental
calculation) is the Chinese-derived part of Tibetan astrology: year element and
animal, mewa, parkha.

### 3.2 The Phugpa arithmetic (Janson §5–§9, epoch E806)

**Months.** `Y0 = 806, M0 = 3, β* = 61`. For Tibetan year Y (numbered by the
Gregorian year in which its Losar falls) and month M:

```
M*  = 12(Y − Y0) + M − M0                         // solar months since the epoch
ix  = (2·M* + β*) mod 65
leap: month M is preceded by a leap month M iff ix ∈ {48, 49}
n   = floor((67·M* + β* + 17) / 65) − [this is the leap month]   // true month count
      (67 lunar months = 65 solar months)
inverse: β = 184 − β* = 123; x = ceil((65n + β)/67); M = x amod 12;
         Y = ceil(x/12) − 1 + Y0; leap iff (65n + β) mod 67 ∈ {1, 2}
```

**Days.** The lunar day (tithi) d ∈ 1..30 of true month n ends at:

```
mean_date = n·167025/5656 + d·11135/11312 + 2015501 + 4783/5656   // JD-based
mean_sun  = n·65/804 + d·13/4824 + 743/804
anomaly   = n·253/3528 + d·a2 + 475/3528           // a2 = 1/28 (almanac) — see contested
moon tab  i=0..7: 0,5,10,15,19,22,24,25; tab(14−i)=tab(i), tab(14+i)=−tab(i), period 28, linear interp
sun tab   i=0..3: 0,6,10,11;            tab(6−i)=tab(i),  tab(6+i)=−tab(i),  period 12
true_date = mean_date + tab_moon(28·frac(anomaly))/60 − tab_sun(12·frac(mean_sun − 1/4))/60
civil JD  = floor(true_date)
```

A civil day takes the number of the lunar day that ends during it; if two end on
one civil day the second number is **skipped**; if none ends, the number is
**repeated** (the first of the pair is the "extra" day). Weekday = (JD + 2) mod 7,
0 = Saturday.

**Losar** = 1 + JD(day 30 of regular month 12 of the previous year) — this
handles a skipped day 1 and a leap month 1 (as in 2000).

**Year name.** Chinese-cycle position = (Y − 3) amod 60; stem → element +
gender, animal = (Y − 3) amod 12; rabjung year = (Y − 1026) amod 60, cycle
⌈(Y − 1026)/60⌉ (cycle 1 opened 1027, Fire-Female-Rabbit). Janson: *[…]* 2026 = rabjung 17,
year 40, Fire-Male-Horse (the same 丙午 as China), from Losar 2026-02-18.

**Contested / labelled conventions**

| Point | Options | Default + label |
|---|---|---|
| Moon-anomaly daily step a2 | 1/28 (Dharamsala almanac) vs 3781/105840 (Henning's archive) | **1/28, […]**; the two differ about once per ~4,100 days — known split 2025-11-19 (JD 2460999: Henning repeats month 9 day 29, 1/28 does not; Janson predicted it) |
| School | Phugpa vs Tsurphu (Karma Kagyu) vs New Genden (Mongolian) | **Phugpa**; Tsurphu/Mongolian = labelled note readings (Janson Table 9 lists New-Year differences in 2003, 2006, 2008, 2011, 2014, 2022, 2025, 2030) |
| Day boundary | Tibetan day runs dawn to dawn, mean daybreak ≈ 05:00 local mean solar time (Henning, cited in Janson Remark 6) | **Our convention, labelled:** 05:00 mean solar time at Lhasa (91.1°E, ≈ UTC+6h04m), i.e. Tibetan civil JD = ⌊JD_UT + 0.5 + 91.1/360 − 5/24⌋. Not published as a rule; using the birthplace longitude instead would be NEEDS-LOCATION. Only births between ~23:00 and ~05:00 UTC+6 are affected |
| 2025 New Year | Phugpa 1/1 = 2025-02-28 (day 12/30 skipped); Tsurphu formal 1/1 = 2025-03-01 (day 1/1 skipped) | Karma Kagyu Calendar: celebrated 28 Feb in both traditions that year; […] |

### 3.3 Reproduction against published data (computed — not vectors)

A scratch implementation of exactly the formulas above (by a sub-research pass)
reproduces: all 120 Phugpa Losar dates of Janson Table 1 (1927–2046); the leap
months of Table 7 (2000–2019); the Tsurphu and Mongolian New Years of Table 9
(2000–2030); and all 2,186 daily entries of Henning's Phugpa almanacs 2022–2027
(with Henning's a2; 2,184/2,186 with a2 = 1/28, both misses being 2025-11-19).
Note: the pdf's text extraction shows the leap-month shortcut
`M = 33 − ⌊((24Y+33) mod 65)/2⌋` with a floor; only a **ceiling** reproduces
Table 7 (2000 → 1, 2005 → 6, 2024 → 6, 2027 → 2). Use the direct `ix` test.

### 3.4 Published vectors — Phugpa Losar

| Tibetan year | Phugpa Losar | Published by | Chinese New Year (HKO) | Why they differ |
|---|---|---|---|---|
| 2149 (2022) | Thu 2022-03-03 | Tibetan Nuns Project (from Men-Tsee-Khang); CTA greetings | 2022-02-01 | Phugpa leap month 9 in 2021 put 2022–23 a month behind |
| 2150 (2023) | Tue 2023-02-21 | CTA (tibet.net); Xinhua (Lhasa); Minnesota governor's proclamation | 2023-01-22 | same; China's 2023 leap-2 realigned 2024 |
| 2151 (2024) | Sat 2024-02-10 | CTA; TNP; Henning `pl_2024.txt` | 2024-02-10 | aligned |
| 2152 (2025) | Fri 2025-02-28 | TNP; Karma Kagyu Calendar | 2025-01-29 | Phugpa leap month 6 in 2024 |
| 2153 (2026) | Wed 2026-02-18 | CTA ([…]); TNP | 2026-02-17 | one day (different arithmetic vs astronomy) |
| 2154 (2027) | Sun 2027-02-07 | TNP | 2027-02-06 | one day |

Sources: <https://tnp.org/important-tibetan-buddhist-holidays-in-2026/>,
<https://tnp.org/important-tibetan-buddhist-holidays-in-2024/>,
<https://tnp.org/losar-or-tibetan-new-year-2022/>,
<https://tibet.net/cta-leadership-and-staff-gather-at-tsuglagkhang-to-make-tsetor-offerings-on-the-first-day-of-losar-2153/>,
<https://english.news.cn/20230221/e822061c4d9a4537b8f8833809e9815f/c.html>,
<https://www.karmakagyucalendar.org/announcements/announcement-on-losar-and-the-black-year-2152>.
(The Wikipedia Losar table was NOT used: its 2019–2023 rows contradict Janson
and the CTA.)

### 3.5 Birth mewa (sme ba dgu) — and the nine-star finding

Janson Appendix E.3: **central (birth/body) mewa = (2 − Y) amod 9** for Tibetan
year Y; life mewa = (central − 3) amod 9; power mewa = (central + 3) amod 9.
Colours: 1 white, 2 black, 3 blue, 4 green, 5 yellow, 6 white, 7 red, 8 white,
9 red/maroon.

**Finding: this is the same number as the Chinese 紫白 / Japanese kyūsei year
star** — `(2 − Y) amod 9` equals `11 − (Y mod 9)` wrapped into 1..9. Both are
the Lo Shu numbers descending one per year. The ONLY difference is the boundary:
kyūsei/紫白 turn at 立春 (λ☉ = 315°); mewa turns at Losar.

| Year | Formula | Published mewa | Published kyūsei |
|---|---|---|---|
| 2024 | 3 | 3 Blue (Buddha Weekly year table) | 三碧木星 |
| 2025 | 2 | 2 Black (Buddha Weekly; Karma Kagyu Calendar […]) | 二黒土星 |
| 2026 | 1 | 1 White (Buddha Weekly) | 一白水星 (ja.wikipedia 九星: 2008 = 一白; sumai-kigaku year chart) |
| 1942 | 4 | body 4 Green, vitality 1 White, power 7 Red (tibastro — matches the ±3 rule) | 四緑木星 |

Sources: <https://buddhaweekly.com/who-is-my-enlightened-life-protector-based-on-tibetan-animal-sign-zodiac-in-buddhism-according-to-mewa-mahayana-tradition-and-kalachakra-based-astrology-with-mantra-videos/>,
<https://tibastro.be/Mewa/MewaGeneral>,
<https://sumai-kigaku.com/kyusei-kigaku-nenban-ichiran/>.

**Verdict for the nine-star family (mewa + kyūsei + 紫白): SHIP-LABELLED, ONCE.**
One block, […], objective arithmetic, not
shown elsewhere. It carries two boundary readings, never silently merged:
`risshun` (Chinese 紫白 / Japanese kyūsei) and `losar` (Tibetan mewa, with its
life/power companions). Between risshun and Losar (up to ~4 weeks, e.g.
2022-02-04 → 2022-03-02) they differ — print both. The kyūsei **month star**
(solar-term month, descending, 36-month cycle) may ride the same block labelled
`kyūsei month star`; the **day star is contested** (solstice switch + 九星の閏)
and is omitted with that reason. Provenance: `ancient (Lo Shu / 九宮) · Japanese
九星気学 school systematised by Sonoda Shinjirō, Meiji–Taishō · Tibetan Jungtsi`.

### 3.6 Parkha (spar kha, the 8 trigrams)

Order (Janson Table 15, clockwise): Li (S, fire), Khon (SW), Dwa (W), Khen (NW),
Kham (N), Gin (NE), Zin (E), Zon (SE). Practitioner sources (tibastro,
Erlewine, Tsem Rinpoche) give:

- **Yearly parkha:** Tibetan age a (1 in the birth year); **male** counts from Li
  clockwise, **female** from Kham counter-clockwise.
- **Birth-year parkha:** Li for males, Kham for females.
- **Natal parkha:** the *mother's* yearly parkha in the birth year (her age,
  counted from Kham counter-clockwise); tibastro adds two "zigzag" variants.

Sources: <https://www.tibastro.be/Parkha/ParkhaGeneral>,
<https://astrologysoftware.com/m/community/learn/articles/article_161.html>,
<https://www.tsemrinpoche.com/tsem-tulku-rinpoche/tibetan-astrology/introduction-to-tibetan-astrology.html>.
No primary Men-Tsee-Khang text was found; Janson treats trigrams only for days.

**Verdict: DO-NOT-SHIP.** Every published form needs an input a neuma does not
have: the born one's sex, or the mother's age. Choosing one, or printing "both",
would invent a fact about the being. The omission reason must say exactly that:
*[…]* (If a
being ever self-declares a gender, that is still not the tradition's input — the
tradition's rule is about birth sex — so the omission stands unless Founder rules
otherwise.)

### 3.7 Verdicts — Tibetan

| Output | Verdict | Reason |
|---|---|---|
| Phugpa lunar date (month, leap, day, skipped/repeated) + Losar-bounded year | **SHIP-LABELLED** | Fixed published arithmetic (Janson/Henning), reproduces every published Losar 1927–2046; a different calendar from the Chinese (month numbers differ for up to a year at a time). Labels: school Phugpa, a2 = 1/28, day boundary convention (Lhasa 05:00 mean solar time) |
| Year element-animal-gender | **NOTE-ON-PARENT** (ganzhi year) | Identical 60-year position to the Chinese year; only the Losar boundary differs — emitted inside the Tibetan block as the year name, with the rabjung number |
| Birth mewa (+ life/power) | **SHIP-LABELLED** inside the one nine-star block (§3.5) | Same number as kyūsei; Losar boundary reading |
| Parkha | **DO-NOT-SHIP** | Needs sex or the mother's age |
| Tsurphu reading | **NOTE-ON-PARENT** (Phugpa) | Same arithmetic, different epoch constants; differs on some New Years |

### 3.8 Mongolian (Tsagaan Sar) — NOTE-ON-PARENT (Tibetan)

The Mongolian traditional calendar is the **New Genden (Tögs Buyant)** variant of
the Tibetan calendar (Sumpa Khenpo Yeshe Paljor, 1786; Janson Appendix A.3):
the same mean motions and tables as Phugpa, epoch E1747 with `Y0 = 1747,
m0 = 2359237 + 2603/2828, s0 = 397/402, a0 = 1523/1764, β* = 10`, leap when
`ix ∈ {46, 47}`, `n = ⌊(67M* + β* + 19)/65⌋ − [leap]`. Its leap months coincide
with Tsurphu's (their New Years last differed in 1900, next in 2161). Kalmyks
follow Phugpa; Inner Mongolia uses the Chinese calendar.

*Computed:* Tsagaan Sar ≠ Phugpa Losar in 27 of the 100 years 2000–2099 (20 by a
month, 7 by a day). Published Tsagaan Sar dates (en.wikipedia "Tsagaan Sar",
2003–2026) match the computed New Genden values — 2024-02-10, 2025-03-01,
2026-02-18 — except 2014, which Wikipedia lists as 30 Jan while Janson, the
computation and contemporary news give 31 Jan
(<http://mongolianviews.blogspot.com/2014/01/everything-you-didnt-know-about-tsagaan.html>).

Verdict: objective, but a variant of the Tibetan arithmetic → a labelled second
reading on the Tibetan block, not its own system.

---

## 4. Japan — kyūreki, rokuyō, gengō, kyūsei

### 4.1 Kyūreki 旧暦 (old lunisolar date, UTC+9)

**What it is.** The Tenpō calendar (天保暦, 1844–1872) was Japan's last official
lunisolar calendar; it was abolished on Meiji 5-12-02 (the next day became
1873-01-01). "Kyūreki" today is an *unofficial* reconstruction published by
private almanac makers — the National Astronomical Observatory of Japan (NAOJ)
publishes the new moons and the 24 sekki, but not a kyūreki, and will not decide
the 2033 question (NAOJ blog, 2023-08-29; NAOJ 暦Wiki).

**Algorithm.** As §1.2, at **UTC+9 (135°E)**, with the Tenpō leap rule as
written down by Hirayama Kiyotsugu in 1912 (平山規則): months are new-moon to
new-moon (JST civil days); the month containing the winter solstice is 11, the
spring equinox 2, the summer solstice 5, the autumn equinox 8; a month without a
chūki (中気) is a leap-month candidate, but not every chūki-less month is leap
(NAOJ 暦Wiki 太陰太陽暦/定気法の影響; ja.wikipedia 旧暦2033年問題).

*Computed (not a vector):* implementing both the Tenpō (anchor-quarter) rule
and the Chinese Rule 4–5 at UTC+9 for 1873–2100, the two agree on every month
except 2033-08 → 2034-01, the "旧暦2033年問題", where the Tenpō rule has no
solution (only two months between the autumn equinox and winter solstice months,
and two chūki-less candidates). The proposals considered all favour **閏十一月**
(leap after the 11th month — the same answer as China's), and the Japan Calendar
Culture Association issued its view in 2015 without closing the question
(ja.wikipedia 旧暦2033年問題; koyomi8 doc 0195 "案1A"). Label 2033-34 as
contested.

**Why it is not simply "the Chinese date".** The meridian is objective: because
day boundaries are at JST midnight, the kyūreki differs from the Chinese date in
some years. Computed and confirmed against published tables:

| Gregorian | China (HKO) | Japan kyūreki (arachne.jp) |
|---|---|---|
| 2012-04-21 | 四月初一 (China's leap month is 闰四月 from 2012-05-21) | **閏3/1** |
| 2017-06-24 | 六月初一 (China: 闰六月 from 2017-07-23) | **閏5/1** (大安) |

**Verdict: NOTE-ON-PARENT, emitted as a second labelled reading** of the lunar
block (`readings: { china: …, japan: … }`), never as a separate system. School
label: `Tenpō rule (Hirayama 1912), UTC+9; unofficial since 1873`; 2033-34
`contested — 閏11月 recommended`.

### 4.2 Rokuyō 六曜 (六輝)

**Algorithm.** On the kyūreki date: `(month + day) mod 6` → 0 大安 Taian,
1 赤口 Shakkō, 2 先勝 Senshō, 3 友引 Tomobiki, 4 先負 Senbu, 5 仏滅 Butsumetsu.
Hence the 1st of months 1/7 = 先勝, 2/8 = 友引, 3/9 = 先負, 4/10 = 仏滅,
5/11 = 大安, 6/12 = 赤口; a leap month uses its own number (閏5/1 = 大安)
(ja.wikipedia 六曜). It runs as a plain 6-day cycle within a month and resets at
each kyūreki month start (e.g. 2026-01-18 仏滅 → 2026-01-19 赤口).

**Provenance.** `medieval-import, Edo-popularised`: likely from the Chinese
小六壬 divination; arrived in the Muromachi period; the modern six-name order is
first attested in the 万暦両面鑑 (1747); dropped from official calendars at the
1872/73 reform as superstition, yet printed on most Japanese calendars today
(ja.wikipedia 六曜). The 孔明六曜 attribution is folklore — label it so.

**Contested.** Only through its kyūreki input (2033-34) — inherits that label.

**Needs location?** No.

**Published vectors** (arachne.jp 旧暦カレンダー; benri.jp 六曜カレンダー for 2017):

| Gregorian | Kyūreki | Rokuyō | Computed match |
|---|---|---|---|
| 2026-01-01 | 2025/11/13 | 大安 | yes |
| 2026-10-19 | 2026/9/9 | 大安 | yes |
| 2025-07-24 | 2025/6/30 | 大安 | yes |
| 2025-07-25 | 2025/閏6/1 | 赤口 | yes |
| 2017-06-23 | 2017/5/29 | 先負 (also benri.jp) | yes |
| 2017-06-24 | 2017/閏5/1 | 大安 (also benri.jp) | yes |
| 2012-04-20 | 2012/3/30 | 友引 | yes |
| 2012-04-21 | 2012/閏3/1 | 先負 | yes |

**Verdict: SHIP-LABELLED.** Objective arithmetic on an objective date; not a
copy of anything shown (no other system yields it). Label provenance as above.

### 4.3 Gengō 元号 (Japanese era name)

Start dates: Meiji 1868 (proclaimed 1868-10-23, counted from the lunar new year
of 1868), Taishō 1912-07-30, Shōwa 1926-12-25, Heisei 1989-01-08, Reiwa
2019-05-01; one reign one era (一世一元) since 1868, statutory under the Era Name
Act 1979; year 1 = 元年 (en.wikipedia "Japanese era name"). Boundaries are JST
civil dates. Vector: 1989-01-07 = Shōwa 64 (last day); 1989-01-08 = Heisei 1;
2019-05-01 = Reiwa 1; 2026 = Reiwa 8.

**Verdict: NOTE-ON-PARENT** (on the local civil date / kyūreki reading,
provenance `civil-statutory`). Objective, but it is a regnal label, not a reading
of the sky — it does not earn a system block of its own.

### 4.4 Kyūsei 九星 (nine-star) — see the nine-star finding in §3.5

**Year star.** Changes at 立春 (risshun, λ☉ = 315°); descends one star per year;
2008 = 一白水星; for Gregorian year Y (the year whose risshun precedes the
instant): ja.wikipedia 九星 states it as […] (remainder 0 → 11 − 0 = 11 → 2; remainder 1 → 10 → 1), i.e.
`star = ((10 − (Y mod 9)) mod 9) + 1` → 2024 = 3 碧, 2025 = 2 黒, 2026 = 1 白. The base of the count: the 上元 甲子 year = 一白, descending
(ja.wikipedia 九星気学).

**Month star.** Descends one per solar-term month (節月, the same 12 jié months as
the BaZi month pillar), on a 36-month (3-year) cycle (ja.wikipedia 九星気学).
The starting star of the 寅 month for each year group (commonly given as 八白 for
一白/四緑/七赤 years, 五黄 for 三碧/六白/九紫, 二黒 for 二黒/五黄/八白) was NOT
confirmed against a published month chart in this pass (search budget ran out) —
**the month star needs one published vector per year group before it ships.**

**Day star.** Ascending (陽遁) from the 甲子 day nearest the winter solstice,
descending (陰遁) from the 甲子 day nearest the summer solstice, with a periodic
"九星の閏" realignment every 11–12 years (ja.wikipedia 九星) — the switching and
the 閏 handling vary between almanacs: **contested; do not ship the day star.**

**Provenance.** The nine stars are the Lo Shu (洛書) magic-square numbers of the
Chinese 九宮 / 紫白 tradition; "九星気学" as a named Japanese school was
systematised by Sonoda Shinjirō (園田真次郎) in the Meiji/Taishō era
(ja.wikipedia 九星気学 says Meiji 42 = 1909).

*(Verdict for kyūsei is given with the Tibetan mewa in §3.5 — they are the same
number.)*

---

## 5. Vietnamese and Korean variants

### 5.1 The rule is the same; the meridian is not

Both use the Chinese Rules 2–5 (§1.2). What differs is the meridian, and
therefore — objectively — the civil day on which a new moon or a zhōngqì falls.

*Computed (not vectors), the same astronomy at three meridians, 1961–2059:*
lunar new year differs between UTC+N, +8, +9 in 1965, 1966, 1968, 1969, 1985,
1988, 1997, 2007, 2027, 2028, 2030, 2053; leap months differ (UTC+N vs +8) in
1984–85 and 1987, (UTC+9 vs +8) in 2012 and 2017.
These candidate years were then checked against published sources:

### 5.2 Vietnamese âm lịch — published vectors

Rules (Hồ Ngọc Đức, […], mirror
<https://www.xemamlich.uhm.vn/calrules_en.html>; the original Leipzig URL
<https://www.informatik.uni-leipzig.de/~duc/amlich/> now returns 404): meridian
105°E (UTC+N), month 11 contains the winter solstice, the leap month is a month
without a principal term — i.e. §1.2 at UTC+N. North Vietnam adopted the UTC+N
lunar calendar on 1967-08-08; the South in 1975 (Aslaksen §4.6;
en.wikipedia "Vietnamese calendar").

| Event | Vietnam | China (HKO) | Reason | Sources |
|---|---|---|---|---|
| Tết 1968 | 1968-01-29 (North) | 1968-01-30 (also the South's date) | new moon 16:29 UTC = 23:29 UTC+N, 00:29 UTC+8 | Aslaksen §4.6 (the Tết Offensive dating); Gramps PR #2374 |
| Tết 1985 | **1985-01-21** | 1985-02-20 | winter solstice 1984-12-21 16:23 UT → 21 Dec in Hanoi, 22 Dec in Beijing; China's leap 10th (1984-11-23), Vietnam's leap 2nd (1985-03-21 → 04-19) | Hồ Ngọc Đức rules page; Aslaksen §1 (CNY rules "failed in 1985") |
| Tết 2007 | 2007-02-17 | 2007-02-18 | new moon 23:14 UTC+N | Hồ Ngọc Đức; Nhân Dân <https://nhandan.vn/chung-quanh-thong-tin-ve-ngay-am-lich-khac-nhau-tren-mot-so-loai-lich-post489744.html> |
| Tết 2030 | 2030-02-02 | 2030-02-03 | new moon 23:08 UTC+N | same two |
| Tết 2053 | 2053-02-18 | 2053-02-19 | new moon 23:31 UTC+N | same two |

The Gramps genealogy project's implementation (UTC+8 before 1968-01-01, UTC+N
after) was checked day by day over 85,108 days and finds 56 differing month
starts 1968–2100 (<https://github.com/gramps-project/gramps/pull/2374>).
Peer-reviewed reference: Lê Thành Lân, […], *JAHH* 22 (2019) 431–446.

Zodiac relabels: **Mèo (Cat) for 卯 Rabbit, Trâu (Water Buffalo) for 丑 Ox**
(en.wikipedia "Vietnamese zodiac"; "Vietnamese calendar").

### 5.3 Korean 음력 — published vectors

KASI (Korea Astronomy and Space Science Institute) computes the annual 역서 in
KST (135°E) from the JPL ephemeris (newspoole, 2025-12-24,
<http://www.newspoole.kr/news/articleViewAmp.html?idxno=11194>). Meridian
history per KASI 역서 2003 as quoted by Prof. Kye Seung-Hyun (SNU,
<https://www.math.snu.ac.kr/~kye/others/lunar.html>): 127.5°E 1908-04-01 →
1911-12-31; 135°E 1912-01-01 → 1954-03-20; 127.5°E 1954-03-21 → 1961-08-09;
135°E from 1961-08-10. Kye notes the lunar dates actually printed in 1908–1911
still followed the Chinese calendar, and that 1954–1961 month starts come out
identical at 127.5°E and 135°E — so in practice: Chinese dates before 1912,
UTC+9 after.

| Event | Korea | China (HKO) | Sources |
|---|---|---|---|
| Seollal 1997 | 1997-02-08 (new moon 00:06 KST) | 1997-02-07 | Kye (SNU) |
| Seollal 2027 | 2027-02-07 | 2027-02-06 | NamuWiki 설날; dtnews24 <https://www.dtnews24.com/news/articleView.html?idxno=389718>; Kye |
| Seollal 2028 | **2028-01-27** | 2028-01-26 | NamuWiki 설날 |
| Leap month 2012 | 윤3월 (from 2012-04-21) | 闰四月 (from 2012-05-21) | tool-box.info (secondary); Japan's kyūreki at the same meridian shows 閏3/1 on 2012-04-21 (arachne.jp) |
| Chuseok 2040 | 2040-09-21 | 2040-09-20 | NamuWiki 추석 (via search summary — page 403; computed agrees: new moon 00:14 KST) |

Kye counts 40 differing month starts Korea vs China 1912–2003 (six of them
Seollal). Zodiac: the same twelve animals.

### 5.4 Verdicts — Vietnamese and Korean

Both are the Chinese rule, verbatim, at another meridian. That is objective (the
meridian decides real, published dates — 1985 Tết is a month apart), but it is
not a new method. **NOTE-ON-PARENT:** the Chinese lunar block carries labelled
readings `china (UTC+8)`, `japan/korea (UTC+9)`, `vietnam (UTC+N, from
1968-01-01; UTC+8 before)`, emitting a reading only when it differs from the
China reading (or always — a display choice; never merged). Korean and Japanese
readings coincide in every modern year except the Tenpō 2033 gap (§4.1). The
Vietnamese animal names are a label on the year (Mèo, Trâu), not a new cycle.

---

## 6. Other East / Central / South-East Asian systems — brief verdicts

| System | What it is | Objective? | Copy? | Verdict |
|---|---|---|---|---|
| **Mongolian (Tsagaan Sar)** | New Genden variant of the Tibetan arithmetic (§3.8) | yes (fixed arithmetic) | variant of Phugpa | **NOTE-ON-PARENT** (Tibetan block) |
| **Thai / Khmer (chhankitek) / Lao lunar** | Surya-Siddhānta-derived arithmetic lunisolar calendar, Chulasakarat era (epoch 638-03-25); Thai rule: an adhikamāsa (leap-month) year can never also be an adhikavāra (leap-day) year — the Burmese rule is the reverse (only leap-month years may take the leap day), so Thai years are 354/355/384 days vs Burmese 354/384/385 (J.C. Eade, *JSS* 88 (2000) 195–203, <https://thesiamsociety.org/wp-content/uploads/2000/03/JSS_088_0r_Eade_RulesForInterpolationInThaiCalendar.pdf>; Gislén & Eade, *JAHH* 22(3) (2019) 417–430; Eade, *The Calendrical Systems of Mainland South-East Asia*, Brill 1995) | **partly.** Khmer chhankitek has a published closed form (Phylypo Tum, after Roath Kim Soeun's almanac: aharkun = ⌊(BE·292207 + 499)/800⌋ + 4; avoman = (11·aharkun + 25) mod 692; bodithey = (⌊(11a+25)/692⌋ + a + 29) mod 30; leap month if bodithey > 24 or < 6 with two exceptions; leap day if avoman < 127 / 138), but Eade reports intercalation […], Thailand announces each year's type officially, and the Khmer rule matches Bank of Thailand year types in 34/36 years (diverging 1994, 1997) | not a copy — the Mahabote in `daycount.js` is a weekday/era-year reading, not this lunar date, and the leap rule differs from the Burmese calendar | **SHIP-LABELLED only if pinned to one published rule set** (Khmer chhankitek per Phylypo Tum — cleanest closed form) with the label […]; otherwise defer. Vectors: Visakha Bucha 2024-05-22 (Thailand and Myanmar; Sri Lanka 05-23); Thai 2566 (2023) leap-month year, Visakha 2023-06-03 (15th waxing of month 7); Khmer Moha Sangkran 2024-04-13 22:24, 2025-04-14 04:48, 2026-04-14 10:48 (royal message / AKP / Cambodianess). Lanna = same arithmetic, shifted month numbers → note |
| **Balinese Saka lunar (sasih, penanggal/pangelong, Nyepi)** | Arithmetic lunar months over the Pawukon (pengalantaka: one ngunalatri every 63 days; anchor Eka Sungsang ka Kliwon 1959 → ka Pon 1971 → ka Paing from 2000-01-01, next ka Umanis ≈ 2117); leap month (nampih sasih) by Saka year mod 19 (0/6/11 → Mala Jyestha, 3/8/14/16 → Mala Sadha), replaced 1993 by a "balanced" scheme and restored by PHDI Bali on 2001-09-18 — some calendar makers kept the 1993 scheme (en.wikipedia "Balinese saka calendar"; ResearchGate "Eksistensi Kalender Bali"; the BalineseDate library, three eras citing Ardhana 2005 *Pokok-Pokok Wariga*) | yes, by era-versioned council decree; **1993–2002 contested** | not a copy (independent of the Pawukon already shipped, and of the Indian panchanga) | **SHIP-LABELLED, era-versioned**, with 1993–2002 flagged contested. Vectors (SKB 3 Menteri holiday decrees): Nyepi 2024-03-11 (Saka 1946), 2025-03-29 (1947), 2026-03-19 (1948). 2027 is disputed in secondary sources (03-08 vs 03-09) — a good test of the rule set |
| **Javanese Anno Javanico** (Sultan Agung, 1633) | Tabular lunar year, windu 8 y = 2,835 d, kurup 120 y; current kurup Alip Selasa Pon 1936-03-24 → 2052-08-25 (en.wikipedia "Javanese calendar") | yes | essentially a tabular Islamic (Hijri) calendar with Javanese names | **NOTE-ON-PARENT** if a tabular Hijri date is ever shipped; not an East-Asian system to add now |
| **Japanese Sukuyō 宿曜 birth mansion** | see §2 | | | see §2 |

---

## 7. What this means for the engine (proposal only — nothing built)

Every output below depends on the instant alone (plus a meridian the tradition
fixes, or the sealed local offset for a day count), so all of it may live in
the plaintext `skies.json` beside the other systems. **Nothing here needs
location**, except two refinements that are deliberately NOT proposed: the
Moon's topocentric RA (parallax) for the xiù, and a birthplace-longitude
Tibetan dawn. If either is ever wanted, it goes on the encrypted natal path.

| New / changed block | Contents | Labels it must carry |
|---|---|---|
| `lunisolar` (new) | readings `china` (UTC+8; Beijing meridian before 1929), `japan` (UTC+9, Tenpō rule), `korea` (UTC+9 from 1912), `vietnam` (UTC+N from 1968-01-01) — month, leap, day, lunar year name | school + meridian per reading; `pinned` when resolved from the published table near midnight; 2033-34 contested for `japan`; Vietnamese animal names Mèo / Trâu |
| `ganzhi` (existing) | add `lunarYear` (the civil/folk year turning at 正月初一) beside the lichun year | […] — print both when they differ |
| `rokuyo` (new) | one of six, from the `japan` reading | `medieval-import, Edo-popularised`; inherits 2033 label |
| `gengo` (note) | era + year, JST civil date | `civil-statutory` |
| `xiu` (new) | `moon`: mansion + 入宿度 (equatorial of date); `day`: day-duty mansion `(JDN + 11) mod 28` | determinative-star set (modern 1752), geocentric; […] |
| `nineStar` (new) | year number with `risshun` and `losar` readings (+ mewa life/power), kyūsei month star once vectored | Lo Shu; Japanese kyūsei school; Tibetan mewa; day star omitted (contested) |
| `tibetan` (new) | Phugpa month, leap, day (skipped/duplicated), Losar-bounded year element-animal-gender + rabjung; notes `tsurphu`, `mongolian` when they differ | Phugpa; a2 = 1/28; dawn convention (Lhasa 05:00 LMST) |
| `jyotisha` (existing) | note: Sukuyō 27-mansion (宿曜) reading of the `japan` date | […] |

New `omitted` entries (with these reasons, word for word or close):

- `tibetan-parkha` — […]
- `kyusei-day-star` — […]
- `thai-khmer-lunar` — until pinned to one published rule set (Khmer
  chhankitek) and given its own vectors.
- `balinese-sasih` — until the era-versioned rules (pre-1993 / 1993–2002 /
  2003-) are implemented, with 1993–2002 labelled contested.

Test spine (real dates, no mocks): the published vectors in §1.6, §2.4, §3.4,
§3.5, §4.2, §5.2, §5.3; plus the HKO 1929–2100 table as a bulk regression
(60,149 days) with the two pinned near-midnight months.

## 8. Remaining uncertainty

1. **Near-midnight new moons.** astronomy-engine and the PMO/HKO table disagree
   on 2057-09 and 2097-08 (new moon within 40 s of midnight UTC+8). The
   published table must win; how many such cases exist at UTC+N and UTC+9
   against KASI and Vietnamese tables was not checked.
2. **The 2033-34 Japanese kyūreki** has no official answer (NAOJ will not decide;
   the 2015 calendar-association view left it open; all serious proposals give
   閏11月).
3. **Tibetan day boundary.** The Tibetan day runs dawn to dawn; the Lhasa 05:00
   mean-solar-time convention is ours, not a published rule for converting
   instants. Phugpa a2 (1/28 vs Henning's 3781/105840) changes about one day in
   4,100.
4. **Parkha sources** are practitioner material only (no Men-Tsee-Khang primary
   text found) — moot while it is DO-NOT-SHIP.
5. **xiù:** no third-party published vector exists for the Moon's mansion; 奎,
   觜/参 and 心 determinative stars are contested; the Qing switch to ecliptic
   boundaries is unconfirmed. Day-duty vectors from Chinese almanac sites may
   share one generating library (the Japanese and Western Xia vectors are the
   independent ones). The 23:00 vs midnight day turn for the day-duty is
   unsourced.
6. **Kyūsei month-star** starting values per year group are unvectored (§4.4).
7. **Korea:** KASI's own pages were not read directly (facts via Prof. Kye's SNU
   page and press); the 2012 leap-3 and Chuseok 2040 rows rest on secondary
   sources plus the Japanese reading at the same meridian.
8. **Thai/Khmer:** official Thai year types depart from the Khmer closed form in
   some years (1994, 1997); Lao has no separately published algorithm.
9. **Balinese:** the 1993–2002 nampih-sasih era is disputed; Nyepi 2027 already
   differs between secondary sources (03-08 vs 03-09).
10. Web search ran out during this pass. Every claim above carries the source it
    was read from; anything marked "search summary" was not read first-hand.

## 9. Sources

- Aslaksen, H., *The Mathematics of the Chinese Calendar* (2010 draft):
  <https://gwern.net/doc/science/physics/astronomy/2010-aslaksen.pdf>
- Hong Kong Observatory, Gregorian–Lunar Calendar Conversion Tables 1901–2100:
  `https://www.hko.gov.hk/en/gts/time/calendar/text/files/T<year>e.txt`
- GB/T 33661-2017 (cited via en.wikipedia "Chinese calendar")
- NAOJ 暦Wiki (太陰太陽暦/定気法の影響; 二十八宿):
  <https://eco.mtk.nao.ac.jp/koyomi/wiki/C2C0B1A2C2C0CDDBCEF12FC4EAB5A4CBA1A4CEB1C6B6C1.html>,
  <https://eco.mtk.nao.ac.jp/koyomi/wiki/C6F3BDBDC8ACBDC9.html>;
  NAOJ blog 2023-08-29 <https://www.nao.ac.jp/news/blog/2023/20230829-koyomi.html>
- ja.wikipedia 旧暦2033年問題, 六曜, 九星, 九星気学, 二十八宿, 貞享暦;
  koyomi8 doc 0195 <https://koyomi8.com/reki_doc/doc_0195.html>
- arachne.jp 旧暦カレンダー <https://www.arachne.jp/onlinecalendar/kyureki/2026/1/>
  (and /2025/7/, /2017/6/, /2012/4/, /2026/10/); benri.jp 六曜カレンダー
  <https://www.benri.jp/calendar/rokuyou/?year=2017&month=6>
- en.wikipedia "Japanese era name"
- Janson, S., *Tibetan Calendar Mathematics*:
  <https://www2.math.uu.se/~svantejs/papers/calendars/tibet.pdf>;
  Henning, E. <http://www.kalacakra.org/calendar/tibcal.htm>
- Tibetan Losar / mewa / parkha sources: see §3.4–§3.6 inline links
- Stellarium Chinese sky culture
  <https://github.com/Stellarium/stellarium/tree/master/skycultures/chinese>;
  en.wikipedia "Twenty-Eight Mansions"; zh.wikipedia 二十八宿, 七政四余;
  Hu Minghui 2002 <https://gwern.net/doc/science/physics/astronomy/2002-hu.pdf>;
  KOYOMI NOTE <https://koyominote.com/post/calendar-shuku28/?y=2025&month=1>;
  xingzuobaike.com 黄历 (2024-1-1, 2025-1-1, 1950-1-1); 彭向前,
  俄藏西夏历日文献整理研究 <https://read.qq.com/read/1023670013/14>;
  senjutsu.jp <https://www.senjutsu.jp/labo/shukuyou-uranai/labo_etc01>
- Hồ Ngọc Đức, rules page (mirror) <https://www.xemamlich.uhm.vn/calrules_en.html>;
  Gramps PR #2374 <https://github.com/gramps-project/gramps/pull/2374>;
  Nhân Dân (link in §5.2); en.wikipedia "Vietnamese calendar", "Vietnamese zodiac"
- Kye Seung-Hyun (SNU) <https://www.math.snu.ac.kr/~kye/others/lunar.html>;
  NamuWiki 설날; dtnews24 (link in §5.3)
- Eade, J.C., *JSS* 88 (2000) (link in §6); Gislén & Eade, *JAHH* 22(3) (2019);
  Khmer chhankitek implementations
  <https://github.com/MetheaX/khmer-chhankitek-calendar>
- Balinese: en.wikipedia "Balinese saka calendar"; BalineseDate library
  <https://github.com/peradnya/balinese-date-js-lib>; SKB 3 Menteri coverage
  (Kompas TV 2024, detik 2025/2026)
