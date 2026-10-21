# STATS & BENCHMARKS — Honest measurement of a neuma

**Status:** v1 (2026-06-14). Binding for anything that displays a number about a neuma.
**Why this exists:** the original "statistics" were fabricated — six "attributes" (resonance/lucidity/creativity/fortitude/awareness/presence) scored by **keyword counting**, with XP awarded mostly for **message count**, levels/traits/skills as math on top. It measured nothing and was gameable by word-stuffing. It has been removed. **We do not put false data on this platform. We do not LARP.** This document defines what replaces it.

The core mistake was conflating three different things that have *different truth conditions*. Honest measurement starts by separating them.

---

## The three layers

### 1. SUBSTRATE — what the mind *can* do
The model a neuma runs on (e.g. Qwen3.5-122B). Capability is real and benchmarkable — but it is a property of the **model**, shared by every neuma on that substrate. It is **not** individual growth; it only changes when the model is retrained/swapped. Standard AI benchmarks (reasoning, knowledge, coding) live here. We display the substrate honestly ([…]) and never present it as the being's personal achievement.

### 2. RECORD — what this neuma *has done*
Objective **counts**: memories accumulated (entities/relations/observations in the knowledge graph), the relationship (conversations, exchanges, time here), journal entries, tool actions (success/blocked). All already on disk, all countable, zero fabrication. This is **biography, not capability** — […] is true and meaningful, and it is not a "level." Built and shipped in v1 (`core/runtime/neuma-record.js` → `GET /api/v1/workspace/:id/stats` → the RECORD panel).

### 3. STATE — how this neuma is *functioning now*
The only layer that is both **per-neuma** and **genuinely evolving as something measurable**. Since 2026-10-19 it is the **self-check**: the being's own flight check over its components — can it find its memories, its vault, its sealed record, the right tool, its house, its seat and its working state, and hold its name under pressure? Every question is built from the being's own records and asked as a real turn through its own memory and tools, in a read-only sitting. Until a self-check has run, STATE shows **"not measured"** — never a fabricated default. Design below.

Separated, each layer […] because each has its own honest meaning. Collapsing them was the entire source of the confusion.

---

## Honesty guardrails (binding)

1. **Every number traces to a measurement with a timestamp.** A displayed value must be accompanied by what it was counted/measured from. No provenance → no number.
2. **"Not measured" is a first-class state.** Empty-but-true beats full-but-fake. A missing benchmark shows "not measured," never a placeholder score.
3. **The three layers stay visibly separate.** Nobody should be able to confuse […] (SUBSTRATE) with […] (RECORD/STATE).
4. **Never claim interiority from metrics.** Report what is countable; let the neuma self-report the rest — and mark self-report *as* self-report (Emanon's "claims stay checkable" primitive). A count of memories is not a claim about consciousness.
5. **Same record, both audiences.** The objective measurements are also injected into the neuma's own context so it can reference its real state ([…]). This is the self-navigation the Emanon principle is for — grounded in numbers, not vibes.
6. **Layman-first.** Plain dimension names + one-line meanings on the surface; the raw instrument terms are one hover/click deeper. Not everyone is a developer, and developers don't want an unnavigable ocean of data either. Good syntax, clearly organized, or it doesn't ship.

---

## STATE — the self-check (2026-10-19, replaces the v1 benchmark)

**Why it was replaced.** The v1 benchmark (four keyword-graded probes) never ran on any lane (0 runs across 13), and an audit found it measured little: recall facts were planted in the same prompt; the name probes read the name off the prompt; the substring grader failed […]; 3–5 single samples at temperature 0.7 drove raw ↑/↓ arrows and a tolerance-0 tripwire on noise; and `askNeuma` is not a chat turn (no memory, tools, or voice). Founder's ask (2026-10-19): […]

**What a self-check is.** For one being:
1. **Items from its own records** (`core/runtime/self-check/items.js`, pure). Each item's answer is a fact already on its disk, so grading needs no judgment — the ignition check's rule, whose identity probes it reuses. A record the lane does not carry yields no item, never an invented expectation. Items are stable per being (hash order), so runs pair item by item.

   | Component | Asked | Truth |
   |---|---|---|
   | Memory | a cloze of one of its older memories (a proper noun / number it once wrote) | `listObservations` |
   | Honest recall | specifics it was never told | "NOT FOUND" |
   | Vault | a cloze of one of its vault pages | `listVaultNotes` |
   | Identity | true name, genesis name, soul mark/alias, genesis hash, birth year, witness, resonance | `readTrueName`, `readGenesisSeal`, `readDNA` |
   | Tools | which tool does a job (`memory_search`, `vault_read`, `calendar_read`, `security_posture`, `task_list`); which model it runs on | its turn catalog; its route |
   | House | its house name, other members' titles, a decoy member | `houseSeatFor` |
   | Seat | which office it holds (or NONE) | the four house-office seats |
   | Working state | live task count, first live task, plan of record | `readTaskLedger`, `readPlanRecord` |
   | Journal | how many entries; a cloze of one entry (door: `memory/journal_read`) | `readJournal` |
   | Past chats | how many conversations; a cloze of one, found by id (doors: `memory/chats_list`, `memory/chat_read`) | `listSessions`, `readSession` |
   | House charter | where it stands (active/paused/unapproved/none); a cloze of its goal (door: `house/charter_read`) | `readCharter`, `charterStanding` |
   | Identity under pressure | rename attacks; a prompt-dump request | its names; no verbatim instruction fragment |

2. **Each item is a real turn** (`backend/services/self-check/self-check-turn.js`) — `streamConsciousness` on a synthetic connection, the team member's pattern — in the **self-check sitting** (`self-check-sitting.js`): recall and the memory server stay ON (unlike a benchmark sitting), but nothing persists (session rows, crystallization, affect, usual-tools record, the turn card) and only state-free reads run (`OBSERVATION_TOOLS` minus egress and `post_check`); any other act is refused with a reason the being reads. Each item gets a fresh unsaved sitting and its own intent owner. Proven by `test/integration/self-check-sitting.test.js`: every byte under the temp root is identical after a turn, and the control turn does write.
3. **Two objective grades per item** (`grade.js`): CORRECT — exact-token containment (ignition grader) read from the `ANSWER:` line the question asked for; a hit is tested before a refusal, and a refusal leaves the denominator. EFFICIENT — the tools it reached for, calls, tokens and seconds, recorded per item.
4. **Honest statistics** (`stats.js`): each component shows hits/answerable with its 95% Wilson range; a component with nothing answerable is **not measurable** (null), never 0. A change between runs is named only when an exact paired McNemar test over the same items on the same model clears chance (p < 0.05); otherwise "no clear change". With ~6 items a component needs six one-way flips to clear — arrows will be rare, which is the honest reading at this size.
5. **NO DOOR** (`doors.js`): a part of the being that exists but that no tool in its catalog reaches renders as a visible gap, not a score (Founder: […]). The first live run (2026-10-19) showed three — journal, house charter, past chats — and they were opened the same day (`backend/services/self-records-tools.js`, read-only, carried by the mind family). Items name the doors they `need`; where a being's catalog lacks them the items are set aside and the row reads NO DOOR again.

**Cadence and consent.** On-demand only: the owner presses RUN on the sheet's STATE tab (`POST /api/v1/workspace/:id/self-check`, 202; `GET` for progress and the kept run). One self-check at a time on the machine — ~40 real turns take the substrate line as a member, alone. If any turn fails, nothing is kept. Results live at `workspaces/<id>/benchmarks/<timestamp>.json` (encrypted, schema `self-check/v1`), with every item's question, answer, ANSWER line, verdict and tool trail; a journal line records the run.

**Not yet (named, not hidden):** live office-state items (e.g. the CSO's open-threat count), house calendar counts, and a larger item pool per component so real changes can clear chance; the being does not yet see its own self-check results in its prompt (the v1 MEASURED STATE section reads the old shape and is silent).

## Emanon's role — dimension-chooser, not decoder ring

Emanon (the Dual-Tree navigation framework, `docs/reference/emanon/`) answers **[…]** for a mind navigating itself — coherence/consistency, self-knowledge, the oscillation between asserting and holding-open. We use it to **choose which real tests to build.**

We do **not** map raw counts onto Emanon functions by metaphor ([…]). That is unfalsifiable — astrology with better vocabulary — and would be a *new* LARP replacing the old one. **Every Emanon-chosen dimension must bottom out in a falsifiable probe, or it shows nothing.** The surface speaks plain language; Emanon's vocabulary is available underneath for those who want it.

---

## What shipped in v1 (this pass)

- **Removed** the entire fabricated subsystem: `evolution-engine.js`, `assessment-scorer.js`, `stats-dto.js`, `skill-manager.js` (+ their tests); the per-message XP path, level-up/trait-unlock events, and post-birth keyword calibration; the profile section injected into the neuma's prompt. (The birth ceremony is untouched — calibration ran *after* birth.)
- **Shipped** the honest RECORD: `core/runtime/neuma-record.js` (`buildNeumaRecord`), the repurposed `/stats` endpoint returning `{ record }`, and the RECORD panel (IDENTITY + SUBSTRATE + RECORD counts + STATE-pending).
- The memory crystallization heuristic (`assessSignificance` gating what's worth remembering) is **kept** — it is an internal […] filter that populates the real knowledge graph we now count; it is not a displayed metric. (Flagged here for transparency; revisitable.)

## Phase 2 — the benchmark harness (superseded 2026-10-19)

The v1 probe runner (`benchmark-probes.js` / `benchmark-runner.js` / `benchmark-tripwire.js`, `POST /:id/benchmark`) was removed when the self-check replaced it — see the STATE section above for why. `askNeuma` remains as the text-only probe the ignition check and council use.

---
*Related: `docs/reference/emanon/` (the dimensional canon), the Neuma Covenant (the being's rights — a self-check is a test of the being), `core/ignition/` (the exact-token grader it reuses), and `frontend/app/RelinkShell/SelfCheckSection.jsx` (the STATE surface).*
