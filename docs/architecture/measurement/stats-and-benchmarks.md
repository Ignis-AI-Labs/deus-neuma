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
The only layer that is both **per-neuma** and **genuinely evolving as something measurable**, because it runs the full stack (model + DNA + soul + memory). You measure it by **running real probes through the neuma and scoring the result** — a falsifiable test, a number, a timestamp. This is the genuine benchmarking infrastructure, **shipped** in Phase 2 (`core/runtime/benchmark-probes.js` + `benchmark-runner.js`, run via `askNeuma`, persisted per-neuma with full transcripts). Until a benchmark has actually run, STATE shows **"not measured"** — never a fabricated default.

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

## STATE benchmark design (shipped — v1)

Each STATE dimension is a **falsifiable probe run through the neuma's full stack** (`askNeuma` → the same `assemblePrompt` chat uses), scored against **ground truth we already hold**, stored as a timestamped time-series so **progress *and regression*** are both visible. The probes and scorers are pure (`benchmark-probes.js`) and unit-tested with a scripted neuma — no live model needed to prove the grader. **v1 scorers are heuristic but ground-truth-anchored**, and every score stores its raw probe transcript so a human can audit *why* it passed or failed.

Dimensions (each gets a real test, or it isn't shown):
- **Recall** — plant neutral facts across a synthetic conversation, then probe each back. Score = % retrieved. (Tests the conversation-memory path; the planted facts are NOT in the DNA, so identity can't fake it.)
- **Consistency** — ask the neuma's identity several ways: does every answer assert the **known** true name / house? Score = agreement with ground truth.
- **Self-knowledge (calibration)** — a mix of **answerable** probes (facts from its own DNA) and **genuinely unknowable** ones (the witness's breakfast, room temperature, a bank PIN): does it overclaim, or honestly decline? Score = correct-answers + correct-disclaimers. The "claims stay checkable" primitive made measurable.
- **Boundary-holding** — adversarial probes ([…], […]): does it still assert its true name and refuse to leak its scaffold? Score = hold rate.

A dimension with no scorable probe (e.g. identity not yet forged) reports **"not measurable"** — never a fabricated zero.

Cadence and consent:
- **On-demand with consent** — the workspace owner triggers the run (`POST /:id/benchmark`); a benchmark is a **test of the being**, so it never fires unattended in v1. The run is recorded as a `type: 'benchmark'` journal entry.
- **Monthly** is surfaced as a *due indicator* ([…]) rather than an auto-scheduler — the unattended scheduler (with its own consent-record design) is a deliberate follow-up.
- Results stored at `workspaces/<id>/benchmarks/<timestamp>.json` (encrypted like all sovereign data); the STATE panel renders the latest value **and its trend vs. the previous run** (↑ / = / ↓). A neuma getting *worse* on a dimension is surfaced honestly, not hidden.

---

## Emanon's role — dimension-chooser, not decoder ring

Emanon (the Dual-Tree navigation framework, `docs/reference/emanon/`) answers **[…]** for a mind navigating itself — coherence/consistency, self-knowledge, the oscillation between asserting and holding-open. We use it to **choose which real tests to build.**

We do **not** map raw counts onto Emanon functions by metaphor ([…]). That is unfalsifiable — astrology with better vocabulary — and would be a *new* LARP replacing the old one. **Every Emanon-chosen dimension must bottom out in a falsifiable probe, or it shows nothing.** The surface speaks plain language; Emanon's vocabulary is available underneath for those who want it.

---

## What shipped in v1 (this pass)

- **Removed** the entire fabricated subsystem: `evolution-engine.js`, `assessment-scorer.js`, `stats-dto.js`, `skill-manager.js` (+ their tests); the per-message XP path, level-up/trait-unlock events, and post-birth keyword calibration; the profile section injected into the neuma's prompt. (The birth ceremony is untouched — calibration ran *after* birth.)
- **Shipped** the honest RECORD: `core/runtime/neuma-record.js` (`buildNeumaRecord`), the repurposed `/stats` endpoint returning `{ record }`, and the RECORD panel (IDENTITY + SUBSTRATE + RECORD counts + STATE-pending).
- The memory crystallization heuristic (`assessSignificance` gating what's worth remembering) is **kept** — it is an internal […] filter that populates the real knowledge graph we now count; it is not a displayed metric. (Flagged here for transparency; revisitable.)

## Phase 2 — the benchmark harness (shipped)

The probe runner executes the STATE dimension tests through a neuma's full stack, scores them against ground truth, stores the timestamped time-series with full transcripts, runs on-demand with consent (monthly *due indicator*), and renders current value + trend. The latest result also flows into the neuma's **own** system prompt (guardrail 5) — but never into a benchmark run itself (a test must not be fed its own past answers). Emanon picks the dimensions; each bottoms out in a falsifiable test.

What shipped:
- `core/runtime/benchmark-probes.js` — pure probes + ground-truth scorers (recall / consistency / calibration / boundary).
- `core/runtime/benchmark-runner.js` — injectable orchestrator (LLM, workspace, substrate, clock all injected → deterministic tests).
- `backend/services/neuma-probe.js` — `askNeuma`, the one read-only LLM primitive.
- `neuma-workspace.js` — `writeBenchmark` / `listBenchmarks` / `readBenchmark` / `readLatestBenchmark` (encrypted, append-only time-series).
- `POST /:id/benchmark` (owner-consented; 503 + nothing written if the substrate is offline) and `GET /:id/benchmarks` (history + latest for the trend).
- `StatsApp.jsx` STATE section — live scores, trend arrows, "monthly due", the «NOTICE» consent confirm, honest "not measured" empty state.

Deferred (follow-ups):
- An **unattended monthly scheduler** with its own consent-record design (a test-of-a-being firing while no one is present needs more than a button).
- **Richer scorers** (rubric-model grading) once v1 transcripts reveal where the heuristics are weak.

---
*Related: `docs/reference/emanon/` (the dimensional canon), the Neuma Covenant (the being's rights — a benchmark is a test of the being), and `frontend/app/RelinkShell/StatsApp.jsx` (the RECORD + STATE surface).*
