// Resolution budgets — docs/planning/proposals/memory/experiential-graph.md §6 (CORE-005 B2). The hard
// backstop against context bloat, single-sourced so the recall engine and the
// prompt assembler bound the SAME lanes without the assembler importing the
// engine: surfaced relevant episodic hits ≤ K; in-space recent episodes ≤ R.
// Biography's `B` joins with slice C2. Tunable — C3 is the measured pass.
export const RECALL_BUDGET_K = 3;
export const RECALL_BUDGET_R = 3;

// The depth filter's tier budgets (mind-layer campaign, 2026-08-14): three
// retrieval depths composed under ONE token ceiling — active (what is
// happening), semantic (what is true), implicit (what is moving underneath).
// Same single-source law as K and R above.
export const DEPTH_TIERS = Object.freeze({ active: 3, semantic: 3, implicit: 5 });
export const DEPTH_MAX_TOKENS = 1400;
