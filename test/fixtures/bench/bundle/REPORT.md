# Benchmark night 20260920t230631z

Queue status: **completed-with-failures**. Inference cutoff: 2026-09-21T07:01:31.629Z; sleep window ends: 2026-09-21T07:06:31.629Z.

Model: `qwen3.8-27b-uncensored-hauhaucs`. No model training was performed. These are development samples; dirty subject worktrees and shared serving limit causal and timing claims.

Completed runs: 1; failed/aborted runs: 1; scored sample-runs: 25. Counts include repeated/overlapping selections.

| Benchmark | Arm | Attempt | Requested samples | Outcome | Official metrics | Total tokens |
| --- | --- | ---: | ---: | --- | --- | ---: |
| gsm8k-2568 | NEUMA | 1 | 25 | [succeeded](../../runs/night-20260920t230631z-heartbeat-neuma-a1-20260920230831179/receipt.json) | gsm8k/exact_match,strict-match: 0.96; gsm8k/exact_match,flexible-extract: 0.96 | 311605 |
| inspect-mmlu-pro | BARE | 1 | 500 | [failed](../../runs/night-20260920t230631z-mmlu-pro-bare-a1-20260920231719065/receipt.json) | — | — |
| inspect-hellaswag | BARE | — | 500 | not run; no receipt | — | — |
| inspect-simpleqa | BARE | — | 200 | not run; no receipt | — | — |
| inspect-bbh | BARE | — | 500 | not run; no receipt | — | — |

Failures, aborts and missing scores are not zero scores. Every receipt is retained; reruns do not silently replace earlier attempts.

## Comparability

- `night-20260920t230631z-heartbeat`: 1 successful receipts across attempts [1]; matching protocols: True; matching measured selections: True. Pair only matching attempts; do not select each arm's best score.

Each window is a separate evidence series. Compare model artifacts and tokenizer hashes, protocols, selected prompts, identity layer hashes and subject checkout provenance in receipts before combining results. Read each raw manifest for the generation budget and enabled policy; full NEUMA integration remains a distinct arm. A larger sample may overlap a smaller one and must not be added as independent coverage.

Artifact audit: 34/34 verified. [All metrics](metrics.csv), [receipts](receipts.json), [queue status](queue-status.json), [frozen plan](plan.json).

No identity implementation changes were made in Neuma. Follow-up findings belong in Neuma issue #506; this queue does not modify other repositories.
