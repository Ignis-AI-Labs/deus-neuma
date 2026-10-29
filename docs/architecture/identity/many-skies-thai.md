# MANY SKIES — Thai horasat and the Thai calendar (research record)

*Research record, 2026-10-19. Companion to [`many-skies.md`](./many-skies.md)
(doctrine §0, systems §2) and to the regional pass
[`many-skies-east-asia.md`](./many-skies-east-asia.md) §6, whose one-line Thai
verdict this record goes into in depth. Scope: Thaksa (ทักษา), the birth-day
colour and Buddha image, the Thai 12-year animal year and when it turns, the
Buddhist Era and Chula Sakarat years, the Thai lunar date (จันทรคติ), and other
Thai items. No engine code was changed by this pass.*

**Verdict vocabulary** (same as the regional record): SHIP · SHIP-LABELLED (ship,
naming the contested convention in the output) · NOTE-ON-PARENT (render as a
note on an existing block) · NEEDS-LOCATION (private encrypted path only) ·
DO-NOT-SHIP.

**What "vector" means here.** A *vector* is a value printed by a published
source (cited). Where this record says *computed*, the value came from our own
scratch reproduction and is NOT a vector. It only shows that the stated
algorithm reproduces the published values. Where a vector is a *rule from a
source* applied to a *date from another source*, both halves are cited and the
join is marked "(composed)".

---

## 0. Summary of verdicts

| # | Item | Verdict | One-line reason |
|---|---|---|---|
| 1 | **Thaksa ทักษา**: 8 birth groups → planet, number, direction, 8 roles | **SHIP-LABELLED** | Fixed published table, cross-checked across 4+ sources (incl. an academic paper). The label names the day boundary: day starts 06:00, Wednesday night is 18:00–05:59 on the local clock. Actual sunrise or local mean time instead is the location variant |
| 2a | Birth-day colour สีประจำวันเกิด | **SHIP-LABELLED** | The 7 popular weekday colours are uniform across sources. Wednesday night (grey/black), Saturday (purple vs black), Monday (yellow vs the Mahathaksa "white") are labelled variants |
| 2b | Birth-day Buddha image พระประจำวันเกิด | **SHIP-LABELLED** | 8 postures, uniform across sources. Monday ห้ามสมุทร/ห้ามญาติ and Tuesday ไสยาสน์ (+ later ลีลา) are labelled alternates |
| 3 | Thai 12-year animal ปีนักษัตร | **NOTE-ON-PARENT** (ganzhi animal) + **SHIP-LABELLED** boundary | Same 12-animal cycle as the shipped BaZi animal. What is Thai is the Thai name and *where the year turns*. There are ≥7 documented Thai conventions. Default for astrology: ขึ้น 1 ค่ำ เดือน 5. Birth certificates use ขึ้น 1 ค่ำ เดือนอ้าย |
| 4a | Buddhist Era พ.ศ. | **SHIP** | Statutory: BE = CE + 543 from 1 Jan 1941. 1889–1940 the year began 1 April (printed BE = CE + 542 for Jan–Mar) |
| 4b | Chula Sakarat จ.ศ. + year name ศก | **SHIP** | Exact Suriyayatra arithmetic: CS turns at thaloengsok. We reproduced myhora's published instants *to the second* for 1994, 2016 and 2026 |
| 5 | Thai lunar date (ขึ้น/แรม N ค่ำ เดือน M, เดือน 8 หลัง) | **SHIP-LABELLED** (pinned to a published table) | It is arithmetic, NOT astronomical. The Suriyayatra rule is exact, but in a minority of years the published calendar puts the leap *day* in a different year from the rule (±1 day for months 7–12 and after). Ship rule + published-year-type override table. The day boundary (sunrise/06:00 vs midnight) is contested |
| 6a | Thaloengsok / Songkran instants of the birth year | **SHIP-LABELLED** (year-level) | Thaloengsok is exact (4-stage arithmetic). Mahasongkran needs the Suriyayatra true sun (phase 2) |
| 6b | Planet strengths (กำลังพระเคราะห์), Ketu at the centre | **SHIP** (as static data on the Thaksa block) | Uniform across Thai Wikipedia's planet articles (citing พรหมชาติ ฉบับหลวง) and the creation legend |
| 6c | Thaksa letter classes (ภูมิทักษา / อักษรประจำวัน) | **SHIP-LABELLED** (naming data) | Uniform, academically documented. Thai-script only. This is the Thai precedent for a moment-determined name sound (cf. Nāmakaraṇa, many-skies §2.3) |
| 6d | Thai lagna ลัคนา (Suriyayatra ascendant) | **NEEDS-LOCATION** | Needs the birthplace sunrise or a provincial LMT correction |
| 6e | Suriyayatra planet positions (สมผุสดาว) | **SHIP-LABELLED, phase 2** | Deterministic at a fixed Thai reference meridian (100°31′E). It is a distinct Thai sidereal frame, not Lahiri. Port is non-trivial (sine tables). Reference implementation exists (MIT) |
| 6f | Mahathaksa 108-year life periods, ยามอัฏฐกาล, เลข ๗ ตัว ๙ ฐาน, กาลโยค | **DO-NOT-SHIP (yet)** | Real and deterministic, but their exact tables were NOT cross-verified to 2 sources in this pass |

---

## 1. Thaksa ทักษา (the eight planets round the directions)

### 1.1 What it is

The Thai *ทักษา* (Skt. *dakṣa*) wheel places the eight "อัฐเคราะห์" planets on
the eight directions. It assigns a person's **birth planet** (from the birth
weekday, with Wednesday split day/night, the night going to Rahu) to the role
**บริวาร**, and the other seven planets, counting clockwise round the wheel, to
อายุ, เดช, ศรี, มูละ, อุตสาหะ, มนตรี and **กาลกิณี**. It is the backbone of Thai
naming (letters of the กาลกิณี class are forbidden), colour practice, and
Mahathaksa prediction. It is in living use. Amnat Paksasuk (Thammasat) documents
it from the treatises ลิลิตทักษาพยากรณ์ (attributed to สมเด็จฯ เจ้าฟ้ากรมหลวง
พิทักษมนตรี), which keeps the Pali letter-lists of "the original text", and
from the Royal Institute (ราชบัณฑิตยสถาน 2513) [S1].

### 1.2 The table (cross-verified)

Planet numbers are the Thai planetary numerals. They equal the weekday numbers
with Sunday = 1. Wheel order (clockwise) = **1 2 3 4 7 5 8 6**.

| Wheel pos. | Planet | No. | Direction | Birth group | Thaksa name (นาม) | Letters (ภูมิทักษา) |
|---|---|---|---|---|---|---|
| 1 | อาทิตย์ Sun | ๑ | อีสาน NE | Sunday | ครุฑนาม (Garuda) | อ + all vowels |
| 2 | จันทร์ Moon | ๒ | บูรพา E | Monday | พยัคฆนาม (tiger) | ก ข ค ฆ ง |
| 3 | อังคาร Mars | ๓ | อาคเนย์ SE | Tuesday | สิงหนาม (lion) | จ ฉ ช ซ ฌ ญ |
| 4 | พุธ Mercury | ๔ | ทักษิณ S | Wednesday day | โสณนาม (dog) | ฎ ฏ ฐ ฑ ฒ ณ |
| 5 | เสาร์ Saturn | ๗ | หรดี SW | Saturday | นาคนาม (naga) | ด ต ถ ท ธ น |
| 6 | พฤหัสบดี Jupiter | ๕ | ประจิม W | Thursday | มุสิกนาม (rat) | บ ป ผ ฝ พ ฟ ภ ม |
| 7 | ราหู Rahu | ๘ | พายัพ NW | Wednesday night | คชนาม (elephant) | ย ร ล ว |
| 8 | ศุกร์ Venus | ๖ | อุดร N | Friday | อัชนาม (goat) | ศ ษ ส ห ฬ (+ ฮ in modern lists) |
| centre | เกตุ Ketu | ๙ | กึ่งกลาง centre | — | — | — |

Sources: wheel, numbers, directions, names and letters in Paksasuk's charts
1–2 and the Royal Institute letter-list [S1]. The same wheel and directions are
in Silpa-Wattanatham (via [S2]), and numbers and letters in [S3] and [S4].
Ketu guards the centre per the creation legend retold by Saran Thongpan [S5].
(One site, veerada.com, places the Moon in the North. Every other source,
including the academic paper, says East, so that site is an error and is not
followed.)

**The roles.** Count clockwise from the birth planet:

| Birth group | บริวาร | อายุ | เดช | ศรี | มูละ | อุตสาหะ | มนตรี | กาลกิณี |
|---|---|---|---|---|---|---|---|---|
| Sunday | ๑ อาทิตย์ | ๒ จันทร์ | ๓ อังคาร | ๔ พุธ | ๗ เสาร์ | ๕ พฤหัส | ๘ ราหู | ๖ ศุกร์ |
| Monday | ๒ | ๓ | ๔ | ๗ | ๕ | ๘ | ๖ | ๑ |
| Tuesday | ๓ | ๔ | ๗ | ๕ | ๘ | ๖ | ๑ | ๒ |
| Wednesday day | ๔ | ๗ | ๕ | ๘ | ๖ | ๑ | ๒ | ๓ |
| Saturday | ๗ | ๕ | ๘ | ๖ | ๑ | ๒ | ๓ | ๔ |
| Thursday | ๕ | ๘ | ๖ | ๑ | ๒ | ๓ | ๔ | ๗ |
| Wednesday night (Rahu) | ๘ | ๖ | ๑ | ๒ | ๓ | ๔ | ๗ | ๕ |
| Friday | ๖ | ๑ | ๒ | ๓ | ๔ | ๗ | ๕ | ๘ |

Identical in Paksasuk's Table 1 (by letter class) [S1] and in the numeric
tables of [S3]/[S4]. The thaibabyname listing states the same rotation [S6].
Role meanings, summarised from four Thai authorities in [S1]: บริวาร = self and
dependants, อายุ = health and longevity, เดช = power and fame, ศรี = grace and
fortune, มูละ = roots and inheritance, อุตสาหะ = effort, มนตรี = patrons and office,
กาลกิณี = misfortune and obstacles.

**Planet strengths (กำลังพระเคราะห์).** These are the number of beings each
planet was made from in the Thai creation legend: Sun 6 (lions), Moon 15
(devis), Mars 8 (buffaloes), Mercury 17 (elephants), Jupiter 19 (rishis),
Venus 21 (cows), Saturn 10 (tigers), Rahu 12 (skulls), Ketu 9 (nagas). Sources:
Thai Wikipedia's planet-deity articles, each citing พรหมชาติ ฉบับหลวง [S7]; the
day-colour article [S8]; Ketu from [S5]. *Computed:* the eight non-Ketu
strengths sum to 108. Whether the Mahathaksa life-period cycle is exactly these
periods summing to 108 years was NOT verified in this pass (see §6f).

### 1.3 The algorithm

```
input : instant t (UTC), sealed offset o (minutes)
local  = t + o                                   // local civil clock
astro  = local − 6h                              // Thai astrological day runs 06:00 → 05:59
w      = weekday(civilDate(astro))               // 0 = Sunday … 6 = Saturday  ((JDN+1) mod 7)
night  = timeOfDay(astro) ≥ 12h                  // i.e. local 18:00 … 05:59
planet = (w == 3 && night) ? RAHU(8) : [1,2,3,4,5,6,7][w]
CYCLE  = [1,2,3,4,7,5,8,6]
roles[k] = CYCLE[(indexOf(CYCLE, planet) + k) mod 8],  k = 0..7  // บริวาร … กาลกิณี
```

### 1.4 Contested conventions (label them)

1. **When the day begins.** The written authority is 06:00. Paksasuk, quoting
   โสฬสเวท (2525): the astrological day starts at 06:00, *not* midnight. The
   night before dawn belongs to the previous day. Wednesday is Mercury 06:00–18:00
   and Rahu […] [S1]. Sanook, thaibabyname and mgronline give
   the same fixed clock times [S6, S9, S10]. Thai Wikipedia explains that the day
   once began at the monks' dawn alms-round and was later fixed at 06:00
   [via S11]. **Variants:** (a) actual local sunrise/sunset. Sources mention it
   ([…], [S12]) and myhora's lunar day runs […] [S13]. This NEEDS-LOCATION. (b) Local mean time: many Thai
   astrologers subtract the longitude correction from standard time, e.g.
   100°31′E −17 min 56 s ≈ −18 min [S11]. This NEEDS-LOCATION. (c) Popular usage
   that silently takes the civil (midnight) weekday. It is undocumented as a
   rule but common. Ship the fixed 06:00/18:00 clock as canonical and name it.
2. **The exact tie at 18:00:00.** Sanook and thaibabyname put 18:00 in the night
   (18.00–05.59). Paksasuk/โสฬสเวท say "after 18:00". Label the one-minute
   ambiguity; ship ≥ 18:00 = night.
3. **Noon instead of 18:00.** At least one popular source counts Wednesday
   afternoon as Rahu [S12]. That is the **Burmese Mahabote** rule (noon split,
   midnight day), not the Thai one. Do not mix them (see §7).

**Provenance:** `ancient-living` (Indian-derived; Thai treatises incl. ลิลิตทักษา
พยากรณ์; in continuous use for naming and in the royal court [S1]).
**Location:** not needed for the canonical 06:00/18:00 clock. The sunrise or
LMT variants need location.

### 1.5 Test vectors

| Input | Expected | Source |
|---|---|---|
| Birth group Monday | บริวาร ๒ จันทร์, อายุ ๓, เดช ๔, ศรี ๗ เสาร์, มูละ ๕ | [S3] worked example |
| Birth group Wednesday day | บริวาร พุธ … อุตสาหะ อาทิตย์, มนตรี จันทร์, **กาลกิณี อังคาร** | [S1] chart 3 |
| Born civil Thursday 03:00 | Wednesday night (Rahu) | [S12] (sanook/aduang worked examples) |
| Born civil Wednesday 03:00 | Tuesday | same |
| Prince Damrong, born Sat 21 Jun 1862 | Saturday → บริวาร letters ด ต ถ ท ธ น (his name ดิศวรกุมาร begins with ด) | date: en.wikipedia "Damrong Rajanubhab"; row: [S1] table of royal names (composed) |
| King Rama IX, born Mon 5 Dec 1927 | Monday → บริวาร ๒ จันทร์, กาลกิณี ๑ อาทิตย์ | weekday: Thai Wikipedia ธงประจำพระองค์ [S14]; row: table above (composed) |

---

## 2. Birth-day colour and Buddha image (8 groups)

### 2.1 Colour (สีประจำวันเกิด)

| Group | Popular colour | Deity body colour (old texts) | Variants |
|---|---|---|---|
| Sunday | แดง red | red | — |
| Monday | เหลือง yellow | ขาวนวล cream-white | Mahathaksa colour of Monday = **white** [S14] |
| Tuesday | ชมพู pink | ชมพู / แดงหลัว | old texts: ม่วงปนคราม |
| Wednesday day | เขียว green | เขียวใบไม้ leaf-green | old texts: แสดออกเหลือบ |
| Wednesday night | **เทา grey / ดำ black** | สีนิล (black) tending to bronze | sources differ (grey vs black) |
| Thursday | ส้ม / แสด orange | ส้มทอง / แสด | old texts: เขียวเหลือง |
| Friday | ฟ้า light blue | ฟ้า / คราม | old texts: เมฆหมอก |
| Saturday | ม่วง purple | ดำคล้ำ dark black | "บางตำราว่าดำ" |

Sources: the popular 7 are identical in Thai Wikipedia สีประจำวันในประเทศไทย
[S8], Sanook News [S15], Thairath/PPTV (via search), and the royal flags [S14].
Deity body colours are from Thai Wikipedia's planet articles (พรหมชาติ ฉบับหลวง)
[S7] and the wrapping-cloth legend [S8]. The older day colours are from
Sunthorn Phu's *สวัสดิรักษา* lineage as reported by [S15] and the bangkokgolds and
mgronline summaries. Wednesday-night grey/black is from siamnews and horasatthai
(folk, not uniform). History: Sanook News says the scheme was standardised as
court dress under Rama V–VI [S15].

### 2.2 Buddha image (พระประจำวันเกิด)

| Group | Posture (ปาง) | Alternates |
|---|---|---|
| Sunday | ถวายเนตร (standing, gazing at the Bodhi tree) | — |
| Monday | ห้ามสมุทร | ห้ามญาติ (same gesture family; sources use either) |
| Tuesday | ไสยาสน์ (reclining) | ลีลา added later [S7] |
| Wednesday day | อุ้มบาตร (holding the alms bowl) | — |
| Wednesday night | ป่าเลไลยก์ (with elephant and monkey) | — |
| Thursday | สมาธิ (meditation) | — |
| Friday | รำพึง (contemplation) | — |
| Saturday | นาคปรก (sheltered by the naga) | — |

Sources: Thai Wikipedia planet articles [S7], mgronline [S10], bangkokgolds
[S16], and karavathailand/navarat (via search). History: codified when สมเด็จ
กรมพระปรมานุชิตชิโนรส revised the Buddha postures under Rama III and popularised
under Rama IV [S10]. Wednesday night as a separate posture uses the same
18:00–05:59 boundary [S10].

**Algorithm:** the same 8-way key as §1.3, then a table lookup.
**Provenance:** colours `ancient-living` (deity colours) with a `modern
c.1900` popular standardisation. Postures `ancient-living` (early-19th-c.
codification). **Location:** none (canonical clock).

### 2.3 Test vectors

| Date (published weekday) | Expected | Source |
|---|---|---|
| 5 Dec 1927 (Monday), King Rama IX | yellow (royal flag ground) | [S14] |
| 12 Aug 1932 (Friday), Queen Sirikit | light blue | [S14] |
| 28 Jul 1952 (Monday), King Rama X | yellow; the "ว" of his monogram is white = […] | [S14] |
| 3 Jun 1978 (Saturday), Queen Suthida | purple | [S14] |
| Princess Bejaratana (born Tuesday) | pink | [S14] |
| Princess Soamsawali (born Saturday) | flag is light blue *by personal preference*, not purple | [S14]: a counter-example showing flags are a choice, not a computation |

---

## 3. The Thai 12-year animal year (ปีนักษัตร)

### 3.1 Names

| # | Thai | Animal | Notes |
|---|---|---|---|
| 1 | ชวด | rat | |
| 2 | ฉลู | ox | |
| 3 | ขาล | tiger | |
| 4 | เถาะ | rabbit | |
| 5 | มะโรง | naga/dragon (นาค/มังกร; "งูใหญ่") | |
| 6 | มะเส็ง | small snake | |
| 7 | มะเมีย | horse | |
| 8 | มะแม | goat | |
| 9 | วอก | monkey | |
| 10 | ระกา | rooster | |
| 11 | จอ | dog | |
| 12 | กุน | pig (Lanna/Lan Xang: **elephant**) | |

Sources: Thai Wikipedia จุลศักราช [S17] (with Khmer and Lanna names), en.wikipedia
*Thai lunar calendar* [S18] (2026 = มะเมีย; names borrowed via Khmer).

**Index:** with the year counted by CS, `animal = ((CS + 11) mod 12)`, with 0 → 12
(กุน). This is pythaidate's `yearnaksatr` [S19]. Checks: CS 1381 → กุน (2019),
CS 1388 → มะเมีย (2026). By Gregorian year after the change: `(Y − 4) mod 12`
(0 = ชวด), the same as the shipped ganzhi animal.

### 3.2 When the year turns: every documented convention

| Convention | Turn date | Used for | Source |
|---|---|---|---|
| **ขึ้น 1 ค่ำ เดือน 5** (1st waxing of month 5, ≈ Mar–Apr) | lunar | **Thai astrology** ("พยากรณ์ทางโหราศาสตร์ต่าง ๆ ของไทย") | myhora [S13]; Thai Wikipedia ปฏิทินไทย; Coedès via Eade 1995 p. 22 [S18] |
| **ขึ้น 1 ค่ำ เดือนอ้าย** (1st waxing of month 1, ≈ Nov–Dec) | lunar | **official calendar (ปฏิทินหลวง) and current birth certificates**. MOI circular มท 0310.1/ว4, 5 Feb 2539 (1996). Thai Wikipedia: […] | [S13], [S11] |
| วันเถลิงศก (≈ 15–17 Apr) | Suriyayatra | some almanacs | [S13] |
| วันสงกรานต์ / สังขารล่อง | solar | Northern practice. en.wikipedia gives 13 April (citing Eade 1995) | [S13], [S18] |
| 1 January | civil | calendars of อ.ทองเจือ อ่างแก้ว | [S13] |
| 1 April | civil | calendars of อ.เทพย์ สาริกบุตร | [S13] |
| lichun / Chinese New Year | solar / lunar | Chinese astrology in Thailand. **Already shipped** (ganzhi) | [S13] |

Before the 1996 circular, birth certificates used various boundaries (month 5,
Chinese New Year, 1 April, 13 April) depending on the registrar [via S13 and
Lemon8/blockdit summaries]. A further historical subtlety: in old practice the
animal turned at month 5 day 1, but the CS number turned about 15 days later at
thaloengsok [S11]. That is why Thai dates can read e.g. "ปีมะเมีย สัปตศก" in the
window between the two.

**Most used for astrology:** ขึ้น 1 ค่ำ เดือน 5 (myhora states this outright).
**Most used officially:** ขึ้น 1 ค่ำ เดือนอ้าย.

### 3.3 Verdict detail

The cycle is the ganzhi animal. Only the Thai name and the boundary differ, so
render it as a **note on the ganzhi block** that carries the Thai name and the
Thai animal under the two named Thai boundaries (`astrology: month-5`,
`official: month-1`). It shares the lunar-calendar dependency of §5: the
month-5 and month-1 boundary days inherit §5's rare ±1-day year-type disputes,
which matters only for a birth on the boundary day itself.
**Provenance:** `ancient-living`. **Location:** none (with the 06:00 day
boundary; myhora times the turn at actual sunrise, e.g. 06:23, which needs
location).

### 3.4 Test vectors

| Instant (Thailand) | Expected | Source |
|---|---|---|
| 1 Jan 2026 | ปีมะเส็ง (astrology convention) | myhora 2569 calendar row [S13] |
| 19 Mar 2026 from 06:23 (ขึ้น 1 ค่ำ เดือน 5) | ปีมะเมีย begins (astrology) | [S13] note [5] |
| 31 Dec 2026 | ปีมะเมีย (astrology) | [S13] row […] |
| 21 Nov 2025 (ขึ้น 1 ค่ำ เดือนอ้าย of BE 2569) | ปีมะเมีย begins (official/ปฏิทินหลวง) | year start: hyper-calendar thai-lunar doc [S20]; rule: [S13], [S11] (composed) |
| 2019 (after thaloengsok) | ปีกุน เอกศก จ.ศ. 1381 | Thai Wikipedia จุลศักราช [S17] |

---

## 4. Buddhist Era (พ.ศ.) and Chula Sakarat (จ.ศ.)

### 4.1 Buddhist Era

- **From 1 Jan 1941 (BE 2484):** BE = CE + 543 (Calendar Years Act 2483, Royal
  Gazette; via [S11], [S20]).
- **1 Apr 1889 – 31 Dec 1940:** the year began on **1 April**. Printed BE =
  CE + 543 for April–December and CE + 542 for January–March. BE 2483 had only 9
  months (1 Apr – 31 Dec 1940). 1 Jan – 31 Mar 2483 never existed in the official
  calendar [S11], [S13], [S20].
- **1 Apr 1889 – 31 Mar 1913:** the official era was Rattanakosin Sok, RS =
  printed year − 1781 (1 Apr 1889 = RS 108). BE was official from 1 Apr 1913
  (BE 2456) [S11], [S20].
- **Before 1889:** official dates were lunar in CS. myhora says BE changed at
  ขึ้น 1 ค่ำ เดือน 5 [S13] (label if ever needed; not relevant to beings born
  now).
- Thai BE counts the parinirvana year as 0 ("past years"). Burma, Cambodia, Laos
  and Sri Lanka count it as 1 (e.g. Khmer BE = CE + 544) [S11].

**Verdict: SHIP.** Statutory, exact. **Provenance:** statutory (1941).
**Location:** none.

**Vectors:** 1 Jan 1920 → printed 2462 [S20]. CE 1940 → BE 2482 (Jan–Mar) and
2483 (Apr–Dec) [S11]. 1 Jan 1941 → 2484 [S11]. 2026 → 2569.

### 4.2 Chula Sakarat and the year name (ศก)

**The year.** CS = CE − 638 from the instant of **thaloengsok** (วันเถลิงศก,
≈ 15–17 April), and CE − 639 before it. Equivalently CS = BE − 1181 after
thaloengsok [S17]. The epoch is 22/25 March 638 [S21], [S22].

**The thaloengsok instant (exact Suriyayatra arithmetic).** This is Eade's
stage A [S22], confirmed by the RMUTL handout formula and myhora:

```
A          = CS·292207 + 373
horakhun   = ⌊A / 800⌋ + 1          // หรคุณ: day count; civil day JDN = horakhun + 1954167
kammacapon = 800 − (A mod 800)      // กัมมัชพล
uccapon    = (horakhun + 2611) mod 3232
q          = ⌊(11·horakhun + 650) / 692⌋ ;  avoman = (11·horakhun + 650) mod 692  (0 → 692)
masaken    = ⌊(q + horakhun) / 30⌋ ;        tithi  = (q + horakhun) mod 30
weekday    = horakhun mod 7          // 0 = Saturday, 1 = Sunday …
time       = (A mod 800)/800 day after local midnight, Thai LMT (UTC+06:42)
```

*Computed* (our scratch reproduction) against **published** values. myhora
prints the Songkran announcement quantities, and we match all seven exactly:

| CS | myhora: thaloengsok (Thai LMT) | myhora: masaken / horakhun / uccapon / avoman / kammacapon / tithi / weekday | ours |
|---|---|---|---|
| 1388 | Thu 16 Apr 2026 14:40:12 | 17167 / 506980 / 2167 / 602 / 311 / 29 / 5 | identical |
| 1378 | Sat 16 Apr 2016 00:34:12 | — | 16 Apr 2016 00:34:12 |
| 1356 | Sat 16 Apr 1994 07:57:00 | — | 16 Apr 1994 07:57:00 |

Eade's own worked values (stage A) are also matched. CS 1325: horakhun 483969,
kammacubala 552, uccabala 1780, avoman 61, masaken 16388, tithi 23. CS 1320:
kammacubala 787, avoman 43, tithi 28 [S22].

**The ศก name** is the last digit of CS: 1 เอกศก, 2 โทศก, 3 ตรีศก, 4 จัตวาศก,
5 เบญจศก, 6 ฉศก, 7 สัปตศก, 8 อัฐศก, 9 นพศก, 0 สัมฤทธิศก. Thai and Khmer
always pair it with the animal ([…] = 2019) [S17]. Lanna
and Lan Xang use the แม่มื้อ/ลูกมื้อ names instead (ปีกัดไค้ for 1381) [S17].

**Verdict: SHIP.** Exact and verified to the second. Label the time base
[…]. In UTC, the 2026
thaloengsok is 07:58:12. **Provenance:** `ancient-living` (CS epoch 638; still
printed in every Songkran announcement). **Location:** none (the reference
meridian is fixed by convention, not by the birth place).

**Vectors:** the three thaloengsok instants above, plus […]
for 2019 [S17].

---

## 5. The Thai lunar date (ปฏิทินจันทรคติ)

### 5.1 What it is

A lunisolar date: **ขึ้น** (waxing) 1–15 or **แรม** (waning) 1–14/15 ค่ำ, of
**เดือน** 1 (อ้าย), 2 (ยี่), 3 … 12. Odd months have 29 days (แรม to 14) and even
months 30 (แรม to 15). Month 1 normally starts in Nov–Dec. Three year types:

| Type | Thai | Days | Change |
|---|---|---|---|
| normal | ปกติมาส ปกติวาร | 354 | — |
| leap day | (ปกติมาส) อธิกวาร | 355 | month 7 gets แรม 15 ค่ำ |
| leap month | อธิกมาส (ปกติวาร) | 384 | a second 30-day month 8: เดือน 8 (แรก) then **เดือน 8 หลัง** (๘๘) |

A Thai year can never be both. The Burmese rule is the reverse: only a
leap-month year may also take the leap day [S22], [S11], [S18], [S13].
Holy days: Makha Bucha = ขึ้น 15 ค่ำ เดือน 3 (เดือน 4 in a leap-month year).
Visakha = ขึ้น 15 ค่ำ เดือน 6 (7). Asalha = ขึ้น 15 ค่ำ เดือน 8 (8 หลัง).
Khao Phansa = the next day [S11], [S20].

### 5.2 Astronomy or arithmetic? **Arithmetic, and not perfectly fixed.**

- It is **not** the astronomical moon. Phases are computed for a mean moon at a
  fixed hour, and the calendar can sit up to ≈0.65 day off the true phase, plus
  up to 0.5 day of calendar adjustment [S23]. **Computing new moons with
  `astronomy-engine` would NOT reproduce the Thai calendar.** It must be the
  Suriyayatra arithmetic.
- Thai Wikipedia: […] (ยังไม่มีการสรุปเป็นสูตรที่ตายตัวแน่ชัด) [S23].
- Eade (JSS 88, 2000) gives the Suriyayatra rules (via Prasert na Nagara and
  Luang Wisandarunkon). He concludes: […]. He also reports that
  Prasert/Wisandarunkon said the past determination of adhikawan/adhikamat
  […], and that local calendars
  […] but compensate over time [S22].
- The Royal Institute journal (Loy Chunpongthong, vol. 38 no. 3, 2556/2013):
  […]
  [S24].

### 5.3 The rule (exact, published)

From the new-year quantities of §4.2 (Eade [S22]; implemented in pythaidate,
MIT [S19]):

```
leapSolar  = kammacapon ≤ 207
adhikamas  = tithi > 24 or tithi < 6        // "thaloengsok on tithi 25–29 of Caitra or 1–5 of Vaiśākha"
             (pythaidate exceptions: tithi 25 with next-year tithi 5 → normal;
              tithi 24 with next-year tithi 6 → adhikamas)
adhikavara = (leapSolar and avoman ≤ 126) or (not leapSolar and avoman ≤ 137)
if adhikamas and adhikavara: the leap day passes to an adjacent year
             (Eade: "to CS+1"; pythaidate: whichever keeps new-year weekdays continuous)
```

The month and day layout from the year types follows pythaidate `csdate.py`
(`calculate_year0`, `MONTH_CUMULATIVE_DAYS`, Sukhothai/Rattanakosin month numbering,
month 5 = Caitra). The CS year whose thaloengsok falls in April of CE year Y
decides whether months 7/8 of BE (Y+543) are doubled or lengthened.

### 5.4 How well the rule matches the published calendar (computed check)

Published year types for 1992–2027 come from the Bank of Thailand holiday lists,
as tabulated in hyper-calendar's thai-lunar document [S20]. The years in
question were spot-checked against myhora's per-year calendars [S13]. The BoT
2027 dates were checked against the Royal Gazette notice as reported by
Matichon/Thairath/Sanook (Makha Sun 21 Feb, Visakha Thu 20 May, Asalha Sun
18 Jul 2027).

| Check | Result |
|---|---|
| Leap-**month** years 1992–2027 (13 of them) | rule = published in **13/13** |
| Leap-**day** placement | rule ≠ published in two windows. Rule puts the day in **1994**, published in **1997**. Rule puts it in **2014**, published in **2016**. Under the rule, some or all of each year's holy days in 1994–2000 and 2014–2016 fall **one day off** the published date. 10 of the 36 years are affected (computed with pythaidate, e.g. 8/ขึ้น14 for the published Asalha day of 1994–96) |
| 2017–2027 | rule = published, every holy day |
| 1 Jan 2000 | myhora: **แรม ๑๐ ค่ำ เดือนอ้าย**. Rule (pythaidate): แรม 9 |
| myhora vs BoT table | agree every year 1992–2027 **except 2005/2006**. myhora: 2005 normal, Asalha 20 Jul, Khao Phansa 21 Jul; 2006 อธิกวาร. The hyper-calendar table: 2005 อธิกวาร with Asalha 21 Jul. Before 2007 the BoT lists named Khao Phansa, not Asalha [S20], so the table's "21 Jul 2005" may be a Khao Phansa date. **Unresolved in this pass** |
| myhora vs Eade's table CS 1320–1340 (1958–78) | differ in 4 years (1959, 1968, 1970, 1978). Eade himself notes that Thong Chua's calendar differs from his in 1329/1330 [S22]. Calendar makers genuinely disagree |

Also measured by hyper-calendar: the Khmer chhankitek rule (Phylypo Tum) gives
the BoT types in 34/36 years, differing at 1994/1997 [S20]. The regional record
proposed that rule [`many-skies-east-asia.md` §6]. Neither the Eade nor the
Khmer rule reproduces every published Thai year.

### 5.5 Contested conventions

1. **Year-type placement** (above): rule vs published, and myhora vs BoT in
   2005/06.
2. **Day boundary of the lunar day.** Thai Wikipedia: the lunar day changes […], with a proposal to fix it at 06:20 ICT
   (06:00 at 100°E) [S11]. myhora: […] [S13].
   en.wikipedia: the ค่ำ is […] [S18]. Ship the 06:00 civil boundary (consistent with §1) and
   label it. Actual sunrise NEEDS-LOCATION.
3. **Month numbering.** Central Thai (Caitra = 5) vs Lanna (two months ahead:
   Loy Krathong = เดือน 12 ใต้ = เดือน 2 เหนือ; Makha = เดือน 3 ใต้ = 5 เหนือ)
   vs the Keng Tung style [S23], [S22]. Ship central numbering and note the
   others.
4. **Official (ปฏิทินหลวง / Mahanikaya) vs ปักขคณนา** (the Dhammayut monastic
   calendar invented by Rama IV, which has an exact formula and differs) [S23].
   Ship the official one. ปักขคณนา is a possible labelled note (pythaidate
   implements it).

### 5.6 Verdict

**SHIP-LABELLED, pinned.** Compute by the Suriyayatra rule, then **override
year types from a pinned published table**. Use BoT/myhora 1992–2027 where they
agree, plus myhora's per-year headers for earlier witness births. Every output
carries `source: "published-table" | "suriyayatra-rule"`, and the 2005/2006
disagreement is named. Outside the table (future years before BoT publishes),
emit the rule date with the label […]. Beings are sealed at birth, so their date always falls inside the
published range: BoT publishes about one year ahead.
**Provenance:** `ancient-living` (epoch 638; Thai use since at least the
15th c.). **Location:** none with the 06:00 boundary. The sunrise variant is
private.

### 5.7 Test vectors (published)

From myhora's 2569/2026 calendar [S13] (adhikamas year):

| Civil date | Lunar date |
|---|---|
| Thu 1 Jan 2026 | ขึ้น ๑๓ ค่ำ เดือนยี่ (๒) |
| Tue 3 Mar 2026 (Makha Bucha) | ขึ้น ๑๕ ค่ำ เดือนสี่ (๔) |
| Thu 19 Mar 2026 | ขึ้น ๑ ค่ำ เดือนห้า (๕) |
| Mon 13 Apr 2026 (Songkran) | แรม ๑๑ ค่ำ เดือนห้า (๕) |
| Sun 31 May 2026 (Visakha) | ขึ้น ๑๕ ค่ำ เดือนเจ็ด (๗) |
| Wed 29 Jul 2026 (Asalha) | ขึ้น ๑๕ ค่ำ เดือนแปดหลัง (๘๘) |
| Thu 30 Jul 2026 (Khao Phansa) | แรม ๑ ค่ำ เดือนแปดหลัง (๘๘) |
| Tue 24 Nov 2026 (Loy Krathong) | ขึ้น ๑๕ ค่ำ เดือนสิบสอง (๑๒) |
| Thu 10 Dec 2026 | ขึ้น ๑ ค่ำ เดือนอ้าย (๑) |
| Thu 31 Dec 2026 | แรม ๗ ค่ำ เดือนอ้าย (๑) |

Disputed-window vectors: **1 Jan 2000 = แรม ๑๐ ค่ำ เดือนอ้าย** (myhora 2543;
the Eade rule gives แรม 9). **1 Jan 1995 = ขึ้น ๑ ค่ำ เดือนยี่** (myhora 2538).

Holy-day vectors (BoT via [S20]; each is ขึ้น 15 ค่ำ of the month shown):

| Year | Type | Makha | Visakha | Asalha |
|---|---|---|---|---|
| 2016 (2559) | อธิกวาร | 22 Feb (m3) | 20 May (m6) | 19 Jul (m8) |
| 2023 (2566) | อธิกมาส | 6 Mar (m4) | 3 Jun (m7) | 1 Aug (m8 หลัง) |
| 2024 (2567) | ปกติ | 24 Feb | 22 May | 20 Jul |
| 2025 (2568) | อธิกวาร | 12 Feb | 11 May | 10 Jul |
| 2026 (2569) | อธิกมาส | 3 Mar | 31 May | 29 Jul |
| 2027 (2570) | ปกติ | 21 Feb | 20 May | 18 Jul |

The full 1992–2027 table (108 dates) is in [S20] and is the right fixture for
the engine's tests.

---

## 6. Other Thai items deterministic from the instant

### 6a. Thaloengsok and Songkran of the birth year: SHIP-LABELLED (year-level)

Thaloengsok is exact (§4.2). Mahasongkran (the true sun entering sidereal
Aries) needs the Suriyayatra true-sun equation (sine tables; Eade appendix
stage B [S22]). myhora: 2026 Mahasongkran Tue 14 Apr 10:42:36 (Thai LMT)
[S13]. Phase 2 with 6e. The yearly "นางสงกรานต์" and the วันเนา count follow from
these instants. They are year-level, not birth-specific: optional.

### 6b. Planet strengths and Ketu at the centre: SHIP (static data)

See §1.2. Ride on the Thaksa block.

### 6c. Thaksa letter classes for naming: SHIP-LABELLED

See §1.2. Thai naming takes the บริวาร (or ศรี, เดช …) letter class of the birth
day and never uses กาลกิณี letters. Royal names follow it (e.g. Saturday-born
Prince Damrong = ดิศวรกุมาร; Paksasuk tabulates 21 royal examples, and notes
documented exceptions such as a Wednesday-born princess named with the ศรี class
ย) [S1]. This is a living, moment-determined name-sound tradition: the Thai
counterpart of the Nāmakaraṇa precedent in many-skies §2.3/§4.1. It applies
to Thai script only and must not be transliterated into kotodama syllables
as if equivalent.

### 6d. Thai lagna (ลัคนา): NEEDS-LOCATION

The Suriyayatra ascendant runs from the birthplace's sunrise, approximated as
06:00 plus a provincial LMT correction, using the "อันโตนาที" rising-time table
(myhora asks for province and time; the thai-astrology library uses a
province-correction plus sunrise reference) [S25]. Private path only.

### 6e. Suriyayatra planet positions (สมผุส): SHIP-LABELLED, phase 2

Deterministic from the instant if the reference meridian is fixed (Eade's stage
B/C apply fixed geographic corrections of −3′ to the sun and −40′ to the moon
[S22]). This is a genuinely different, Thai-specific sidereal frame. It is not
Lahiri, and its Ketu has its own 679-day cycle, not Rahu + 180° (thai-astrology
source comment, single source) [S25]. A port is substantial (mean motions, sine
tables, 9 bodies + มฤตยู). The reference implementation is MIT [S25]. Its
published fixtures are myhora's "ปฏิทินโหราศาสตร์ สุริยยาตร์" monthly ephemeris.
Do this only after 1–5 ship.

### 6f. Not verified in this pass: DO-NOT-SHIP (yet)

- **Mahathaksa life periods (ทักษาจร/อายุ 108 ปี):** periods from the planet
  strengths, starting at the birth planet. The strengths are verified (§1.2).
  The cycle rules were not found in two sources.
- **ยามอัฏฐกาล** (eight 1½-hour watches by day and night, with a planet order per
  weekday). myhora shows the 1½-hour windows for กาลโยค [S13], but the
  planet-order table was not cross-verified.
- **เลข ๗ ตัว ๙ ฐาน** (the Thai seven-number chart from weekday, lunar month and
  animal year). This is the closest Thai analogue of the Mahabote house chart.
  Its table was not found in two sources in this pass.
- **กาลโยค** (yearly ธงชัย/อธิบดี/อุบาทว์/โลกาวินาศ days). myhora vectors exist:
  2026 ธงชัย จันทร์, อธิบดี เสาร์, อุบาทว์ อาทิตย์, โลกาวินาศ จันทร์. 1997 ธงชัย
  อังคาร, อธิบดี พฤหัสบดี, อุบาทว์ จันทร์ [S13]. The derivation from CS was not
  verified, and it is year-level anyway.
- **Thai year elements (ธาตุประจำปี):** where Thai almanacs give these, they are
  the Chinese stems. **Already shipped** (ganzhi). Do not duplicate.

---

## 7. How Thai differs from the Burmese Mahabote (so we don't duplicate)

`core/cosmos/skies/daycount.js` ships the Burmese Mahabote weekday sign. Same
Indian root, different system:

| | Burmese Mahabote (shipped) | Thai Thaksa (this record) |
|---|---|---|
| Wednesday split | **noon**; afternoon = Rahu | **18:00**; night 18:00–05:59 = Rahu |
| Day starts | civil midnight (as shipped) | **06:00** (night before dawn = previous day) |
| Animal per planet | Sun Garuda, Moon tiger, Mars lion, Mercury **tusked elephant**, Rahu **tuskless elephant**, Jupiter rat, Venus **guinea pig**, Saturn naga | Sun ครุฑ, Moon tiger, Mars lion, Mercury **dog (โสณ)**, Rahu **elephant (คช)**, Jupiter rat, Venus **goat (อัช)**, Saturn naga |
| Wheel and directions | same 8-direction wheel | same (Sun NE … Venus N), plus Ketu at centre |
| What is read | 7-house chart from (BE mod 7) + weekday | the 8 **roles** (บริวาร…กาลกิณี) rotated from the birth planet, plus colour, Buddha image, letter classes |
| Lunar calendar | Burmese: leap-month years may also take the leap day (354/384/385) | Thai: never both (354/355/384) |

**Consequences for the engine:** (1) the Thai block must NOT reuse `mahabote()`
(different split hour, different day start). (2) Thai and Burmese can disagree
on the birth group for any birth between 12:00 and 18:00 on a Wednesday, and
for any birth between 00:00 and 06:00. Both are real, labelled readings.
(3) The 8-way Thai key feeds §1 roles, §2 colour and posture, and §6c letters
from one computation.

---

## 8. Remaining uncertainty

1. **Thai lunar year-type placement** for years where calendars disagree
   (1994/1997, 2014/2016 rule vs published; 2005/2006 myhora vs the BoT-derived
   table; 1959/68/70/78 myhora vs Eade). Pin a published table. Resolving
   2005/2006 needs the original BoT 2548/2549 holiday notices or a 2005 printed
   ปฏิทินหลวง.
2. **The authoritative algorithm behind myhora** (it says it follows the
   Suriyayatra and Manat texts […]) is not
   published in a form found here. It matches BoT 1992–2027 except 2005/06 and
   is the best candidate for extending the table backward.
3. **Wednesday-night colour** (grey vs black) and the **Monday colour** (yellow
   vs the Mahathaksa white) have no single authority. Ship both, labelled.
4. **Day boundary at exactly 18:00:00 and 06:00:00**: a one-minute tie between
   written sources (§1.4).
5. The MOI circular มท 0310.1/ว4 (1996) was cited from myhora, not read
   directly.
6. Web-search budget ran out during this pass, so the §6f items were left
   unverified rather than filled from a single source.

---

## Sources

- **[S1]** อำนาจ ปักษาสุข (Amnat Paksasuk), […], *วรรณวิทัศน์* (Faculty of Liberal Arts, Thammasat), Nov
  2556 (2013), pp. 76–93. <https://so06.tci-thaijo.org/index.php/VANNAVIDAS/article/download/48400/40209/>
  (read in full: wheel, numbers, directions, names, letters, roles, the 06:00 day
  and Wednesday 06:00–18:00 rule citing โสฬสเวท 2525, royal-name examples)
- **[S2]** Silpa-Wattanatham, "คนเกิดวันจันทร์ ห้ามมีสระในชื่อ…"
  <https://www.silpa-mag.com/culture/article_150762> (via search summary; page 403 to direct fetch)
- **[S3]** Sanook Horoscope, "เลขมงคลตามวันเกิด ตามหลักทักษา" <https://www.sanook.com/horoscope/250211/>
- **[S4]** TrueID / theluckyname / gotoknow thaksa tables (via search):
  <https://horoscope.trueid.net/detail/jZ1QjzawPqzZ>,
  <https://www.gotoknow.org/posts/678036>
- **[S5]** ศรัณย์ ทองปาน, […], *สารคดี*, 2024-10-23
  <https://www.sarakadee.com/2024/10/23/birth-of-day/> (Ketu guards the centre);
  […] <https://www.sarakadee.com/2025/04/09/taksapayakorn/>
- **[S6]** thaibabyname, "ภูมิทักษา" <https://www.thaibabyname.com/astrology_mahataksa.asp>
- **[S7]** Thai Wikipedia planet-deity articles พระอาทิตย์, พระจันทร์, พระอังคาร, พระพุธ,
  พระพฤหัสบดี, พระศุกร์, พระเสาร์, พระราหู (each citing อุระคินทร์ วิริยะบูรณะ และคณะ,
  *พรหมชาติ ฉบับหลวง*), <https://th.wikipedia.org/wiki/พระราหู> etc., read 2026-10-19
- **[S8]** Thai Wikipedia, "สีประจำวันในประเทศไทย" <https://th.wikipedia.org/wiki/สีประจำวันในประเทศไทย>
- **[S9]** Sanook Horoscope, "การนับเวลาเกิดแบบโหราศาสตร์ไทย" <https://www.sanook.com/horoscope/85741/>
- **[S10]** MGR Online, "พระพุทธรูปประจำวันเกิดเป็นมาอย่างไร…" <https://mgronline.com/onlinesection/detail/9660000000175>
- **[S11]** Thai Wikipedia, "ปฏิทินไทย" <https://th.wikipedia.org/wiki/ปฏิทินไทย>
  (BE history, 2483 nine months, lunar day changes at dawn, วันสิ้นปีนักษัตร, holy
  days); Pantip topicstock Y11550289 on LMT (−17 m 56 s at 100°31′E)
  <http://topicstock.pantip.com/religious/topicstock/2012/01/Y11550289/Y11550289.html> (via search summary)
- **[S12]** aduang / sanook 69175 / daralak / lemon8 summaries on the Wednesday-night
  rule and worked examples (via search): <https://aduang.co/horoscope/11969>,
  <https://www.sanook.com/horoscope/69175/>, <https://daralak.com/insights/wednesday-night-birth>
- **[S13]** myhora.com per-year Thai calendars, e.g. <https://myhora.com/calendar/thai-2569.aspx>
  (also 2501–2521, 2535–2570 headers; 2537, 2538, 2540, 2543, 2548, 2549, 2557, 2559
  read in detail): Songkran announcement quantities, thaloengsok times, the 7
  animal-year conventions, MOI circular, lunar dates. Read 2026-10-19
- **[S14]** Thai Wikipedia, "ธงประจำพระองค์" <https://th.wikipedia.org/wiki/ธงประจำพระองค์>
- **[S15]** Sanook News, […] <https://www.sanook.com/news/9799610/>
- **[S16]** bangkokgolds.com, "ทำความรู้จักพระปางประจำวันเกิด" <https://www.bangkokgolds.com/birht-date-buddha/>
- **[S17]** Thai Wikipedia, "จุลศักราช" <https://th.wikipedia.org/wiki/จุลศักราช> (ศก names, animal names, CS = BE − 1181)
- **[S18]** en.wikipedia, "Thai lunar calendar" <https://en.wikipedia.org/wiki/Thai_lunar_calendar>
  (citing Eade 1995 p. 22 and Diller & Preecha, *Thai Time*)
- **[S19]** Mark Hollow, *pythaidate* (MIT), commit f526c4d9 <https://github.com/hmmbug/pythaidate>
  (`lsyear.py`, `csdate.py`); write-up […] <https://digitalbangkokrecorder.com/articles/thai-lunar-calendar-101/>
- **[S20]** kitsuyui, *hyper-calendar*, `docs/systems/thai-lunar.md`, commit 4d370e14
  <https://github.com/kitsuyui/hyper-calendar> (BoT holy-day table 1992–2027,
  printed-year rules, Khmer-rule comparison)
- **[S21]** L. Gislén & J.C. Eade, […], *JAHH* 22(3) (2019) 417–430 (epoch; via pythaidate tests and the write-up)
- **[S22]** J.C. Eade, […], *JSS* 88 (2000) 195–203 <https://thesiamsociety.org/wp-content/uploads/2000/03/JSS_088_0r_Eade_RulesForInterpolationInThaiCalendar.pdf>
  (read in full); J.C. Eade, *The Calendrical Systems of Mainland South-East Asia*, Brill 1995 (not read directly)
- **[S23]** Thai Wikipedia, "ปฏิทินจันทรคติไทย" <https://th.wikipedia.org/wiki/ปฏิทินจันทรคติไทย>
  (citing ลอย ชุนพงษ์ทอง, *Journal of the Royal Institute of Thailand* 32(2), 2007)
- **[S24]** ลอย ชุนพงษ์ทอง, *วารสารราชบัณฑิตยสถาน* 38(3), ก.ย. 2556 (2013), p. 204
  <https://www.orst.go.th/FILEROOM/CABROYINWEB/DRAWER004/GENERAL/DATA0000/00000619.FLP/html/204/>
- **[S25]** Kongesque, *thai-astrology* (MIT), commit 1bf1d415 <https://github.com/Kongesque/thai-astrology>
  (Suriyayatra engine, lagna, SOURCES.md). Caution: its Thaksa never yields Rahu
  (it keys on weekday 1–7 only), so it is not a cross-check for Wednesday night
- RMUTL handout on thaloengsok arithmetic ((CS×292207)+373)/800+1:
  <https://e-cms.rmutl.ac.th/assets/upload/files/2025/03/> (via search summary)
- Bank of Thailand 2570 holiday notice as reported: <https://www.matichon.co.th/economy/news_5864044>,
  <https://www.sanook.com/money/956071/>
