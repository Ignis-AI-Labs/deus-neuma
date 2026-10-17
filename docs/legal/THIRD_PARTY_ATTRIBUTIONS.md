# THIRD-PARTY ATTRIBUTIONS (DISTRIBUTION NOTICE)

Required credit lines for third-party models and code shipped with, or
fetched by, the Software. This file rides every distribution archive; do
not strip it. (DRAFT — for counsel review alongside EULA.md.)

## Kyutai TTS 1.6B (voice engine `kyutai`)

- **Model:** Kyutai TTS 1.6B (`kyutai/tts-1.6b-en_fr`)
- **Author:** Kyutai — https://kyutai.org
- **Model card:** https://huggingface.co/kyutai/tts-1.6b-en_fr
- **Weights license:** Creative Commons Attribution 4.0 International
  (CC-BY-4.0) — https://creativecommons.org/licenses/by/4.0/
  Commercial use is permitted **with attribution**; this notice is that
  attribution. No warranty is given by the licensor; the weights are
  provided as-is under the license terms.
- **Code license:** the moshi inference code (https://github.com/kyutai-labs/moshi)
  is MIT-licensed.
- **Preset voice embeddings:** the `voice-donations/*` speaker embeddings
  (`kyutai/tts-voices`) are CC0 (public domain dedication) and carry no
  attribution requirement. **`expresso/*` embeddings are CC-BY-NC-4.0
  (non-commercial) and are NEVER shipped** — excluded at preset-manifest
  build time and refused by the sidecar's exact-set allowlist.

### Distribution checklist (FR-21 — gates distribution, not development)

1. This file ships in every archive that contains or fetches the Kyutai
   weights.
2. The weights themselves are fetched at install time by the engine
   downloader (`voice-engines/_downloader/`) from the pinned revision in
   `voice-engines/engines.json`; they are not committed to this repository.
   Any offline/managed weights archive must carry a `LICENSE` file with the
   CC-BY-4.0 license text alongside the safetensors files, plus this
   attribution notice.
3. The attribution must remain reachable from the installed product
   (about/legal surface) for as long as the Kyutai engine is included.

## Other voice engines

License posture per engine (full metadata in `voice-engines/engines.json`
and `voice-engines/README.md`):

| Engine | Weights license | Distribution status |
| --- | --- | --- |
| Zonos v0.1 (Zyphra) | Apache-2.0 | shippable |
| Kokoro-82M (hexgrad) | Apache-2.0 | shippable |
| Parler TTS Mini | Apache-2.0 | shippable (registered, unlisted) |
| Whisper large-v3 (SYSTRAN) | MIT | shippable |
| F5-TTS (SWivid) | CC-BY-NC (weights) | **never distributed — local testing only** |
