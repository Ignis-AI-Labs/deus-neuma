# Testing — real behavior, no mocks

**No mocks, stubs, or fake collaborators. This is the non-overridable testing baseline.** A repository may strengthen proof requirements, never exempt itself from this rule.

- Call pure functions with real inputs and check outputs. Fixed inputs and independently derived expected values are valid; replacing a dependency with invented behavior is not.
- Prove each changed user-facing behavior through its actual boundary: HTTP/IPC round trip, real authentication, test database, filesystem write/read-back, running worker, or deployed contract on a local chain, fork, or testnet.
- No module replacement, fake fetch, collaborator spies, fabricated signatures/receipts, or fake timers for timing behavior. Saved responses can test a parser; they do not prove a live provider integration.
- New routes and behavioral fixes include integration/regression coverage in the same change. A regression must fail against the broken behavior. New guards prove both legitimate success and invalid/unauthorized refusal.
- Test failures, retries, cleanup, and boundary values as relevant. Confirm the tests were discovered and executed; zero tests, early returns, skipped live lanes, and build success are not behavioral evidence.
- During development, run the narrowest real tests that prove the change. Before integration/release, run the repository's required lint, type, build, and regression gates once on the final revision. Prose-only changes need document checks, not unrelated application suites.
- Schedule expensive, GPU, paid, or shared-resource lanes under the repository's resource policy. Use real dependencies at smaller scale where valid. If a required lane cannot run, state exactly what remains unproven; do not replace it with a fake or call the release gate passed.
- Never weaken an assertion, refresh a baseline, add a skip, or remove a test merely to obtain green. Existing mocks remain named migration debt; block new mocks and replace old ones with real proof.
- Report commands, scope, outcomes, and material gaps. Keep concise evidence; a targeted pass must not be described as a full-suite pass.
