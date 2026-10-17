# Security audit protocol

Use for periodic whole-system review and before material changes to trust, funds, data, infrastructure, or agent capabilities. Daily changes use [SECURITY.md](./SECURITY.md). This is a scoped audit framework, not a claim that every possible vulnerability is covered.

## Scope and evidence

- Identify the revision, deployed artifacts, environments, assets, trust boundaries, adversaries, and applicable sections. Record exclusions with reasons.
- Test only authorized assets. Use isolated environments for destructive probes; keep production credentials and private data out of evidence.
- For each applicable check record `pass`, `fail`, `unverified`, or `not applicable`, with evidence and date. A scanner's green result does not replace behavioral proof or independent review.
- Record findings with ID, location, reproduction, impact-based severity, owner, remediation, and verification. Escalate active exploitation, exposed secrets, and possible fund/data loss promptly.
- Define response deadlines from exposure and impact. Release-blocking findings remain blockers until fixed and retested or explicitly risk-accepted by the accountable owner. Never silently turn an unverified item into a pass.

## Application and data boundaries

- [ ] Authentication, expiry, revocation, recovery, and replay resistance work through the real entry points. Legitimate users succeed; unauthenticated and wrong-owner users are denied.
- [ ] HTTP, IPC, WebSocket, job, and admin operations enforce resource/tenant authorization. Pre-authentication operations have narrow, documented access rules.
- [ ] Storage policies, grants, object-store access, and privileged-role boundaries enforce intended access under real roles, including cross-tenant attempts.
- [ ] Queries and commands are parameterized; paths, redirects, outbound destinations, and uploads are constrained. Test injection, traversal, server-side request forgery, and mass assignment.
- [ ] Browser origin, cross-site request protection, output escaping, content security, and desktop renderer isolation match the actual authentication model.
- [ ] Requests, messages, queues, uploads, pagination, and long-running jobs have bounded size, rate, concurrency, and duration. Test cancellation and resource exhaustion.
- [ ] External responses and errors preserve the declared contract. Failed reads do not become absence or permission; error output does not disclose secrets or internals.
- [ ] Transactions, idempotency, retry behavior, and event ordering prevent duplicate effects and partial state. Test crash/restart and concurrent requests.
- [ ] Migrations preserve data, constraints, and access policies. Backups restore successfully; important file writes preserve the previous valid state on failure.

## Cryptography, identity, and secrets

- [ ] Established cryptographic implementations use appropriate algorithms, key handling, randomness, authentication, and domain separation. Test tampering and independent known-answer vectors where available.
- [ ] Key generation, storage, access, rotation, revocation, recovery, and destruction have documented owners and tested procedures. Signing displays match the actual operation.
- [ ] Repository history, current changes, build artifacts, images, logs, and release payloads are scanned for secrets. Treat a discovered credential as exposed; coordinate revocation without printing or probing it unnecessarily.
- [ ] Sensitive data and backups are protected in transit and at rest according to their classification. Export and recovery paths do not create unintended plaintext copies.
- [ ] Identity/biometric verification, if used, is tested against replay, manipulated documents, synthetic identities, and input-channel bypass. Define retention and deletion requirements.

## Contracts and value-bearing systems

- [ ] [FUND_FLOW_PROOF.md](./FUND_FLOW_PROOF.md) passes: per-actor conservation, rounding, wrappers, order/frequency, scale, and executable exits.
- [ ] Privileged calls, role changes, governance, pause, and recovery enforce the documented authority. Test both valid and invalid callers; distinguish company-owned assets from user custody.
- [ ] Reentrancy and callbacks cannot observe or exploit inconsistent state, including cross-contract and read-only paths. Validate untrusted call/delegate targets.
- [ ] Arithmetic bounds, casts, shifts, precision, dust, fee behavior, non-standard tokens, and maximum-capacity gas are tested against the real implementation.
- [ ] Oracle age, manipulation resistance, deviation policy, unavailable-feed behavior, and sequencer outages match the product's requirements. Do not substitute an unverified fallback.
- [ ] Slippage, deadlines, transaction ordering, flash liquidity, and market manipulation are adversarially tested. Economic invariants hold before liquidity or exposure increases.
- [ ] Upgrades preserve storage layout and initialization invariants. Test authorization, timing, migration, rollback/recovery, and the new implementation against realistic state.
- [ ] Bridges/cross-chain messaging bind source, destination, sender, nonce, and finality; prevent replay and duplicate issuance. Verify conservation across chains and recovery from reorgs/delays.
- [ ] Chain-specific account ownership, signer/program validation, address derivation, duplicate accounts, and runtime limits are checked where applicable.
- [ ] Custom consensus verifies safety and liveness at declared fault thresholds. Zero-knowledge systems verify circuit constraints, public inputs, transcript binding, replay resistance, and setup/compiler integrity with specialist review.

## Infrastructure and supply chain

- [ ] Dependencies, build tools, scanner versions, images, and CI actions have reproducible identities and reviewed provenance. Preserve upstream licensing; assess applicable advisories.
- [ ] Untrusted contributions cannot execute with privileged credentials or publish artifacts. CI tokens, runner access, and release identities have least privilege.
- [ ] Release artifacts are associated with the reviewed source and verified before deployment. Record component inventory and relevant provenance.
- [ ] Hosts, containers, cloud resources, and orchestration apply least privilege, resource limits, restricted network exposure, patching, and configuration-drift checks.
- [ ] Administrative access, service authentication, encryption, and network segmentation protect the actual boundaries. Verify exposed endpoints and storage rather than relying on dashboard settings.
- [ ] Physical infrastructure and hardware keys have appropriate access controls, tamper protection, power/recovery provisions, and accountable custodians.

## AI and agent systems

- [ ] Retrieved text, files, tool descriptions/results, and inter-agent messages remain untrusted data. Test indirect prompt injection across the actual ingestion and tool path.
- [ ] Tool permissions, destinations, budgets, and consequential-action authorization are enforced outside model-generated text. Validate every tool invocation; constrain credentials and filesystem/network access.
- [ ] Agents cannot expand their own authority through content or tool calls. Interruption, cancellation, and emergency shutdown stop further effects and preserve recoverable state.
- [ ] Tenant data, memory, embeddings, prompts, caches, and model-provider routing preserve confidentiality. Test extraction and cross-tenant leakage using non-sensitive test data.
- [ ] Model, training-data, retrieval-data, and tool provenance are recorded. Re-test relevant adversarial cases when models, prompts, data pipelines, or capabilities change.
- [ ] Structured model output is validated before use; factual or financial action inputs are verified against authoritative data. Apply deterministic value/risk limits independently of model recommendations.
- [ ] Record actions, inputs needed for reproduction, permission decisions, outcomes, and concise rationale. Do not require hidden reasoning traces or store secrets in audit logs.
- [ ] Evaluate multi-turn escalation, encoded/multilingual attacks, poisoned tools/documents, excessive consumption, and failure recovery on the real configured stack. State any untested provider lanes.

## Operations, privacy, and review cadence

- [ ] Maintain a data inventory, classification, access/retention policy, and verified deletion/export process. Assess long-lived encrypted data and algorithm migration needs.
- [ ] The accountable legal/compliance owner determines applicable jurisdictions and obligations for privacy, payments, custody, identity, offerings, and reporting; track requirements against current authoritative sources. Do not copy universal legal thresholds from an old template.
- [ ] Threat monitoring covers deployed services and chains; alerts reach named responders. Exercise incidents involving key compromise, fund loss, data breach, provider failure, and unavailable infrastructure.
- [ ] Access onboarding/offboarding and vendor access are reviewed; revocation is verified. Recovery and incident communication procedures are rehearsed.
- [ ] Use source analysis, dependency/secret checks, authenticated runtime probes, and domain-specific invariant/adversarial tests together. Record scope, tool versions, results, and false-positive rationale.
- [ ] Review relevant advisories daily for production systems: affects us / not affected / investigate, with evidence. Run scheduled scans weekly; review access and patch debt monthly.
- [ ] Review the threat model, this checklist, and incident exercises quarterly. Set independent audit, penetration-test, and specialist-review scope from actual risk; do not treat an arbitrary vendor count as proof.
- [ ] Re-audit affected surfaces after upgrades, new chains/providers, authentication or key changes, expanded agent tools, significant dependencies, or an incident. Re-test fixes before closing findings.

## Completion

The audit report records revision/environment, coverage, exclusions, verified findings and fixes, residual risks, required follow-up, and named reviewer/owner decisions. Publication is a separate authorized action. Keep the historical report; update the live tracker as remediation progresses.
