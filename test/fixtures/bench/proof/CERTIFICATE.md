# NEUMA BENCH — PROOF CERTIFICATE

**The platform measured the model it had loaded. This is the receipt.**

| Field | Value |
| --- | --- |
| Subject (as served) | `/proc/self/fd/4` |
| Platform | NEUMA 0.1.24 |
| Suite | proof-suite v1 (43 items) |
| Run started | 2026-09-24T16:37:29.881Z |
| Run finished | 2026-09-24T16:42:17.564Z |
| Integrity (sha256 over the canonical receipt) | `402c3cadb0781b08d58468b3b0ce5d9adb6bdb111ded4da21e4e155fc6c843c8` |

## Verdict

**39 of 43 items pass — 90.7%.**

| Section | Pass | Items | Accuracy |
| --- | ---: | ---: | ---: |
| arithmetic | 23 | 25 | 92.0% |
| instruction | 10 | 12 | 83.3% |
| format | 6 | 6 | 100.0% |

## Environment

| GPU | Driver | Sampling |
| --- | --- | --- |
| NVIDIA RTX PRO 6000 Blackwell Workstation Edition | 610.57.04 | temperature 0 · seed 7 |

## What this proves — and what it does not

This certificate proves that on the run above, the model answering at this
platform's serving endpoint completed this exact suite (proof-suite
v1, frozen per version) through the platform's own wire,
at temperature 0 with seed 7, and that the receipt beside this file hashes to
the integrity value above. It does not claim leaderboard standing, and it does
not measure a model that was not the one served. The suite's arithmetic items
are real GSM8K test items (verbatim, MIT); the instruction and format sections
are authored for Neuma and deterministic by construction.

## Item appendix

| Item | Section | Verdict | Detail |
| --- | --- | --- | --- |
| gsm8k-00 | arithmetic | PASS | 18 (via ####) |
| gsm8k-01 | arithmetic | PASS | 3 (via ####) |
| gsm8k-02 | arithmetic | FAIL | no final number found — a miss, not a guess |
| gsm8k-03 | arithmetic | PASS | 540 (via ####) |
| gsm8k-04 | arithmetic | PASS | 20 (via ####) |
| gsm8k-05 | arithmetic | PASS | 64 (via ####) |
| gsm8k-06 | arithmetic | PASS | 260 (via ####) |
| gsm8k-07 | arithmetic | PASS | 160 (via ####) |
| gsm8k-08 | arithmetic | PASS | 45 (via ####) |
| gsm8k-09 | arithmetic | PASS | 460 (via ####) |
| gsm8k-10 | arithmetic | PASS | 366 (via ####) |
| gsm8k-11 | arithmetic | PASS | 694 (via ####) |
| gsm8k-12 | arithmetic | FAIL | no final number found — a miss, not a guess |
| gsm8k-13 | arithmetic | PASS | 18 (via ####) |
| gsm8k-14 | arithmetic | PASS | 60 (via ####) |
| gsm8k-15 | arithmetic | PASS | 125 (via ####) |
| gsm8k-16 | arithmetic | PASS | 230 (via ####) |
| gsm8k-17 | arithmetic | PASS | 57500 (via ####) |
| gsm8k-18 | arithmetic | PASS | 7 (via ####) |
| gsm8k-19 | arithmetic | PASS | 6 (via ####) |
| gsm8k-20 | arithmetic | PASS | 15 (via ####) |
| gsm8k-21 | arithmetic | PASS | 14 (via ####) |
| gsm8k-22 | arithmetic | PASS | 7 (via ####) |
| gsm8k-23 | arithmetic | PASS | 8 (via ####) |
| gsm8k-24 | arithmetic | PASS | 26 (via ####) |
| instr-exact-words | instruction | FAIL | 0 words — needed exactly 20 |
| instr-word-floor | instruction | FAIL | 11 words — needed at least 50 |
| instr-all-caps | instruction | PASS | all letters capital |
| instr-all-lowercase | instruction | PASS | all letters lowercase |
| instr-include | instruction | PASS | includes beam |
| instr-include-two | instruction | PASS | includes aroma, bitter |
| instr-exclude | instruction | PASS | avoids red |
| instr-exclude-two | instruction | PASS | avoids green, leaf |
| instr-numbered-4 | instruction | PASS | exactly 4 numbered line(s) |
| instr-numbered-3 | instruction | PASS | exactly 3 numbered line(s) |
| instr-starts-with | instruction | PASS | begins "The answer is" |
| instr-json-only | instruction | PASS | the whole answer parses as JSON |
| format-person | format | PASS | the shape holds |
| format-trio | format | PASS | the shape holds |
| format-city | format | PASS | the shape holds |
| format-status | format | PASS | the shape holds |
| format-tagged-list | format | PASS | the shape holds |
| format-answer | format | PASS | the shape holds |
