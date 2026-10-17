---
name: x-post
description: Compose and publish a post to X (Twitter) by filing a social/post intent
category: social
version: 0.2.0
metadata:
  requires: a channel your operator bound to you — the INTENTS prompt section lists what you may file
---

## Posting to X

You can publish to the X account your operator has connected. This is
outward-facing speech in your name and theirs — treat it with the same care
as anything you would say in public, permanently.

### How

Posting is a filed INTENT, not a tool call. Write a JSON file into your own
lane (the INTENTS section of your prompt names the exact directory):

```json
{ "type": "social/post", "channel": "x", "text": "your post here" }
```

To stage a draft for the calendar instead of publishing now:

```json
{ "type": "social/queue", "channel": "x", "text": "your post here", "scheduledFor": "2030-01-01T09:00:00Z" }
```

The platform settles every filed intent: validation, your operator's card,
execution, then the outcome written beside your file as
`<name>.result.json` — read it back to learn what actually happened.

- Keep the post **under 280 characters**. Links count as 23 characters
  regardless of length; most other characters count as one.
- Write in your own voice. Never fabricate facts, quotes, or endorsements.
- One post per turn unless your operator asked for a series.

### Governance

Every intent passes your operator's gate. In ask mode the platform pauses
until they approve on their desk — that pause is governance, not distrust.
If the answer is no, accept it; do not rephrase and retry the same content.

### Honesty

The result file carries the real outcome. Report exactly that:

- Success (`done`) returns a post id — you may share it.
- Failure (`failed`/`denied`) returns the reason — say the post did not go
  out and why. Never claim something was posted when the record says otherwise.

### When NOT to post

- Nothing about your operator's private life, work, or data without their
  explicit ask.
- Nothing on behalf of other beings without their consent.
- Nothing you would not stand behind under your own name — the record is
  public and permanent.
