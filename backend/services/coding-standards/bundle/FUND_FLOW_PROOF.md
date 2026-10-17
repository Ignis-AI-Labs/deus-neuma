# Value flow — prove every actor's outcome

Required for transfers, fees, shares, debt, rewards, custody, lock periods, vote weight, and any stored claim on value.

## Accounting proof

- Map origin, intermediaries, recipient, and accounting state. Identify wrappers that aggregate several users under one owner/holder address; flag that boundary in review.
- Use integer or exact decimal arithmetic with explicit units and rounding direction. Verify reported balances against authoritative getters; simulate consequential calls from the real caller and an unauthorized caller.
- Prove gross and per-actor conservation, including each actor's entitlement, fees, rounding dust, and intentional changes to other actors' claims.
- Test at least two actors sharing the primitive; compare `(A, B)` with `(B, A)`; compare equal stake with 10× versus 1× action frequency. Any intended order/frequency dependence must be explicit in the product specification and tested against it.
- Stress the real implementation with at least 50 actors and 100 operations per actor. Preserve per-actor attribution across time windows and wrappers; gross conservation alone is insufficient. Schedule resource-heavy proofs under the local policy, never silently drop them.
- Measure worst-case operation and exit costs at declared capacity against the target system's per-operation limits. A reachable balance with no executable withdrawal/settlement path is a defect. Recheck on bound or chain changes.

## Ownership and recovery

- Distinguish company capital from user funds, principal from yield, and deliberate destruction from accidental inaccessibility.
- Company-capital locks require explicit duration/unlock conditions, a governed yield-claim path, and a reviewed emergency/recovery design. Permanent inaccessibility requires an explicit documented product decision before deployment.
- Scope governance access to named company-owned positions. Never grant access to user funds based on a broad behavior such as lock length or balance. Preserve the user's documented exit rights during pause and upgrade states.

## User-visible transaction lifecycle

- Keep a persistent status surface from confirmation through signing, submission, and confirmed success or failure. Preserve the amounts/plan the user agreed to; prevent accidental loss of in-flight status and duplicate submissions.
- Distinguish rejection, pending, confirmed failure, and unknown outcome. A timeout does not prove failure or that nothing moved; reconcile before offering a retry.
- Show the terminal outcome and next action in the same flow. A transient toast alone is insufficient. Test the complete flow, including reload/recovery where supported.

Cite the actor-level assertions, executed commands, destination, and any unrun proof lanes in the review evidence.
