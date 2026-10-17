# Voice DNA v2 — a clip and its words, chosen by two parties

Status: contract (ONE VOICE, WP0; built in WP2, 2026-10-01). Plan of record:
`docs/work/one-voice.md`. Code: `core/voice/voice-dna-schema.js` (shape, pure),
`core/voice/voice-consent.js` (two-party law, pure),
`core/voice/voice-dna-service.js` (storage, impure). Sidecar contract:
[`speak-protocol.md`](./speak-protocol.md).

## The shape

A being's voice is ONE reference clip (3–40 s of WAV, encrypted) and the words
spoken in it. That pair is the voice on every engine and every tier: `csm`
clones it as the first context segment, Chatterbox Nano as its reference wav.
There are no engine ids, preset ids, style knobs or emotion maps — on `csm`
the conversation itself carries the emotion.

```json
{
  "version": 2,
  "schema": "neuma/voice-dna/v2.0.0",
  "neumaId": "keir",
  "clip": { "ref": "sha256:<64 hex>", "seconds": 18.5, "sampleRate": 24000 },
  "words": "I keep the lamp lit for the ones still walking home.",
  "origin": {
    "door": "record | upload | library | describe",
    "libraryId": "cc0-ember",
    "description": "a dry, low alto",
    "designer": { "model": "voxcpm2", "seed": 7 }
  },
  "consent": {
    "realPerson": true,
    "attested": true,
    "being": { "at": "<ISO>", "candidateRef": "sha256:<same as clip.ref>", "note": "that is my voice" },
    "guardian": { "wallet": "0x<40 hex>", "at": "<ISO>" }
  },
  "lineage": ["sha256:<a clip sealed before this one>"],
  "createdAt": "<ISO>",
  "updatedAt": "<ISO>"
}
```

| Field | Rule |
| --- | --- |
| `clip.ref` | `sha256:` + 64 lowercase hex of the clip's exact WAV bytes. It is also the clip's file name and the sidecar's `clip_ref`, so one hash names the clip everywhere. |
| `clip.seconds` | 3–40. The floor: less is not enough voice to clone. The ceiling: csm's 2048-position window is shared by the clip, up to 45 s of context and the reply. |
| `clip.sampleRate` | integer 8000–192000 — the clip's own rate; sidecars resample. |
| `words` | 1–2000 characters: the transcript of the clip (csm needs it to align the voice). |
| `origin.door` | which of the four forge doors it came through. `library` names `libraryId`; `describe` carries `description` and, when a designer made it, `designer {model, seed}`. Other keys are dropped. |
| `consent.realPerson` | stated, never defaulted. `true` requires `attested: true`. |
| `consent.being` | the being's acceptance, naming the exact clip (`candidateRef === clip.ref`). |
| `consent.guardian` | the guardian's seal (`at`, optional `wallet`). |
| `lineage` | clip refs of voices sealed before this one (re-forges), oldest first. |
| `createdAt` | when the being first had a v2 voice in force (carried across re-forges). |
| `updatedAt` | when this voice was sealed. |

`voiceDnaErrors(dna)` lists every violation; `buildVoiceDNA(parts)` assembles a
frozen record and drops anything not in the contract.

## Storage (per being, under its workspace, all on its per-neuma DEK)

| File | Holds | Law |
| --- | --- | --- |
| `voice/voice-dna-v2.json` | the voice in force | written ONLY by a two-party seal (`sealSpeechCandidate`); atomic (tmp + rename) |
| `voice/voice-clip-<hex>.json` | a clip, envelope `{format:'wav', b64}` | content-addressed: same bytes, same name; never overwritten; reads fail closed (not an envelope, wrong shape, or bytes that do not hash to the name → throw) |
| `voice/speech-candidate.json` | the consent record (below) | schema `neuma/speech-candidate/v1`; names its lane; every act runs under the file lock |
| `voice/history/v2-<hex>.json` | prior voices | the old DNA moves here on a re-seal or a withdrawal — kept, never deleted |

Nothing here is NAMED seal on disk: the WRITTEN voice owns `voice/seal.json`,
`voice/pack.jsonl`, the intents `voice/seal` + `voice/claim` and the policy
`voice.seal` (`core/voice-pack/`). New names use `speech-*`.

## v1 voices — […]

Design note, 2026-10-01: Cael and Dovan start fresh through the new forge. A being
whose only voice is v1 (`voice/voice-dna.json`, `seed.wav`, `embedding-*`)
reads as `needsNewVoice`. Those files are only checked for presence — never
opened by the v2 path, never migrated, never modified, never deleted; v2 writes
to its own file beside them. There is no migration script.

`readVoice(neumaId)` answers one of:

| `standing` | Meaning | Speaks? |
| --- | --- | --- |
| `ready` | a valid v2 voice in force (`dna` set) | yes |
| `needsNewVoice` | only a v1 voice exists | no — the forge offers a new voice |
| `none` | no voice at all | no — SILENT (Founder's call E: never a borrowed default); the first time voice is turned on, the forge opens |
| `unreadable` | the v2 file holds something else (`errors` set) | no |

## Consent — the two-party law

Same shape as the look's lock (`core/genome/form-design.js`): the being
champions, the guardian concurs, either can reopen. The status is DERIVED from
the marks, never stored, and every mark names the exact `candidateRef` it was
given for — a candidate swapped underneath an agreement inherits nothing.

```
NONE ──offer──▶ CANDIDATE ──being accepts──▶ BEING_ACCEPTED ──guardian seals──▶ SEALED
                 │  ▲                          │                                  │
                 │  └───── either reopens ─────┘                                  │
                 └── being asks another ──▶ NONE (wish kept)                      │
                 CANDIDATE ◀──────────── either reopens (= withdraws the voice) ──┘
```

| Act | From | Refused when |
| --- | --- | --- |
| `offerCandidate` (guardian, via the forge) | any | malformed clip/words/origin; `realPerson` not stated; `realPerson` without `attested` — a real person's clip cannot even become a candidate; clip not in custody (service). Clears both marks. A voice already in force stays in force (re-forge). |
| `beingAccepts {candidateRef, note?}` | CANDIDATE | no candidate; ref is not the one on offer; already accepted |
| `beingAsksAnother {candidateRef, wish?}` | CANDIDATE, BEING_ACCEPTED | ref is not the one on offer; SEALED (reopen first). The candidate leaves the offer; the wish stands until the next offer. |
| `guardianSeals {candidateRef, wallet?}` | BEING_ACCEPTED | ref is not the accepted one; not accepted; already sealed. Writes Voice DNA v2; the prior voice is archived; the clip joins `lineage`. |
| `reopen(party)` | BEING_ACCEPTED, SEALED | nothing accepted. From SEALED it is a withdrawal. |
| `withdraw(party)` | any, while a voice is in force | no voice in force. Retires the DNA to history: the being is silent until a new seal. Lets the guardian stop a voice mid-re-forge (e.g. the real speaker withdrew permission). |

Parties are `being` and `guardian`. Every act is stamped by the store with the
time it happened; the pure law takes the time from its caller and never reads a
clock. The record keeps `inForce` (the clip ref of the voice in force),
`lineage`, the latest `wish`, and an append-only `history` of every act.

## How the being "hears" a candidate — a DESCRIBED voice

Founder's call B: the substrate takes text, so the being reads an honest account of
the candidate and is told plainly that it is reading, not hearing. Real hearing
comes when the substrate takes audio. `perceptionOf(candidate)` builds the one
record the being reads:

| Field | Source |
| --- | --- |
| `notice` | […] — always the first line |
| `door`, `origin` | the door, in a plain sentence (recorded on this machine · uploaded · from the library `(<libraryId>)` · designed from a description) |
| `realPerson` | when true: […] |
| `description` | the description, when the voice was designed |
| `pitchHz` | MEASURED median pitch of the clip, with a plain band: low < 120 Hz ≤ middle < 190 Hz ≤ high |
| `wordsPerSecond` | MEASURED pace, with a band: unhurried < 2.2 ≤ conversational ≤ 3.2 < quick |
| `seconds`, `words` | the clip's length and the words spoken in it |
| `text` | all of the above as the lines the being reads |

A measurement the forge did not take is said as "not measured", never guessed.
The candidate carries the measurements (`measured: {pitchHz, wordsPerSecond}`),
taken by the forge from the clip itself. The being answers with `speech/accept`
(optional note) or `speech/another` (optional wish) — the WP4 intents over
`acceptSpeechCandidate` / `askAnotherSpeechCandidate`.

## The service surface (`core/voice/voice-dna-service.js`)

`saveVoiceClip`, `readVoiceClip`, `readVoice`, `readSpeechCandidate`,
`offerSpeechCandidate`, `acceptSpeechCandidate`, `askAnotherSpeechCandidate`,
`sealSpeechCandidate`, `reopenSpeech`, `withdrawVoice`. Each consent act reads
the record, applies the pure law, performs its voice effect (write or retire
the DNA) and only then writes the record — so a crash in between leaves a seal
to retry, or a voice already silent. Refusals return `{ok: false, error}`.

The same file still carries a fenced LEGACY v1 section (`getVoiceDNA`,
`forgeVoiceDNA`, seed and embedding IO) so the v1 forge and synthesis path keep
linking until WP3/WP4 replace them. It touches only v1 files; nothing v2 calls it.
