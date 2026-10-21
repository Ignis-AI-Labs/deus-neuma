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
| Nemotron Speech (NVIDIA), live speech recognition | NVIDIA Open Model License | downloaded at setup, not bundled |
| CosyVoice 2 (Alibaba) | Apache-2.0 | downloaded at setup, not bundled |
| Qwen3-TTS 1.7B (Qwen) | Apache-2.0 | downloaded at setup, not bundled |
| Sesame CSM-1B (Sesame AI Labs) | Apache-2.0 | downloaded at setup, not bundled |
| Chatterbox Nano (Resemble AI) | MIT | downloaded at setup, not bundled |
| VoxCPM2 voice designer (OpenBMB) | Apache-2.0 | downloaded at setup, not bundled |
| Cartesia Sonic, ElevenLabs, Hume Octave | each provider's terms | cloud services, the operator's own account |
| F5-TTS (SWivid) | CC-BY-NC (weights) | **never distributed — local testing only** |

## Language models (the substrate the setup recommends — NOT shipped)

The setup (`backend/services/substrate-setup.js`) recommends these by machine size; each is downloaded
from its publisher's repository. Licences read from each Hugging Face model card on 2026-10-20.

| Model | Repository | Licence | Notes |
| --- | --- | --- | --- |
| Qwen3.8-27B Uncensored (HauhauCS), Q8_K_P | HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF | Apache-2.0 | Fine-tune of Qwen/Qwen3.8-27B. |
| Qwen3.8-27B (6-bit, 4-bit) | unsloth/Qwen3.8-27B-GGUF, lmstudio-community/Qwen3.8-27B-GGUF | Apache-2.0 | Quantized builds of Qwen/Qwen3.8-27B. |
| Qwen3.8-27B (3.5-bit, 3-bit) | ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF | Apache-2.0 | IST Austria GSQ-RCO quantization. |
| Qwen3.6-35B-A3B | lmstudio-community/Qwen3.6-35B-A3B-GGUF | Apache-2.0 | Mixture of experts, 3B active. |
| Qwen3.8-4B (distilled) | empero-ai/Qwen3.8-4B-Distill-GGUF | Apache-2.0 | |
| Qwen3.5-4B | lmstudio-community/Qwen3.5-4B-GGUF | Apache-2.0 | |

## Model server set up on first run (NOT shipped)

When a machine has no model server, first run offers to set one up
(`backend/services/managed-ollama.js`): the official Ollama build for the platform is downloaded from
its GitHub release, checked against its published SHA-256, and kept under the platform's data folder.

| Component | Source | Licence | Notes |
| --- | --- | --- | --- |
| Ollama 0.40.7 | github.com/ollama/ollama (release v0.40.7) | MIT | Downloaded at setup, not bundled; the version and checksums are pinned in `managed-ollama-plan.js`. |

## Image & Video Forge (models the pack recognises — NOT shipped)

The Software ships **no** image or video model weights and **not** ComfyUI.
The operator installs ComfyUI and any model themselves, from its publisher,
under that publisher's licence; the forge only recognises a file by name and
SHA-256 (`backend/services/image-forge/pack-registry.js`) and drives the
operator's own ComfyUI as a separate process over loopback HTTP. Each licence
below binds the operator who downloads the model, not this distribution.
Licences read at their sources on 2026-10-20.

| Model / component | Publisher | Licence | Outputs commercial? | Notes |
| --- | --- | --- | --- | --- |
| ComfyUI (engine) | Comfy-Org | GPL-3.0 | n/a | Separate program over HTTP; not bundled, not linked. |
| comfy-kitchen (engine kernels) | Comfy-Org | Apache-2.0 | n/a | Installed with ComfyUI. |
| LTX-2.5 22B distilled (video) | Lightricks | LTX-2.x Community License | Yes, under $10M annual revenue (all affiliates) | Gated download (accept on Hugging Face). Users must follow its Acceptable Use Policy (Attachment A: incl. no sexually explicit content; disclose machine-generated content; no competing product without a licence). Keep any watermark, metadata or provenance it applies. Text encoder Gemma 4: Apache-2.0. |
| Wan 2.2 I2V A14B (video, fp8 repackage) + Wan 2.1 VAE | Wan-AI (Alibaba); repackaged by Comfy-Org | Apache-2.0 | Yes | Ungated. The publisher claims no rights over generated content and holds users accountable for their use of it. Silent clips. Text encoder umT5-XXL (Google): Apache-2.0. Adult content is allowed on this pipeline under the platform's content law; the hard lines are refused on every pipeline. |
| Wan 2.2 Lightning 4-step LoRAs (lightx2v) | lightx2v | Apache-2.0 | Yes | Distillation LoRAs for the two Wan experts. |
| FLUX.2 [klein] 4B + VAE | Black Forest Labs | Apache-2.0 | Yes | Not the 9B klein (non-commercial). |
| Z-Image Turbo / Z-Image, Qwen3-4B encoder | Tongyi-MAI / Qwen | Apache-2.0 | Yes | `ae.safetensors` is the FLUX.1-schnell autoencoder (Apache-2.0). |
| Z-Image Turbo Fun ControlNet Union | alibaba-pai | Apache-2.0 | Yes | |
| SDXL Base 1.0 | Stability AI | CreativeML Open RAIL++-M | Yes | Use restrictions (para. 5) apply. |
| xinsir ControlNet OpenPose SDXL | xinsir | Apache-2.0 | Yes | |
| perfectDeliberate v10 | Desync (CivitAI) | Illustrious License (Fair AI Public License 1.0-SD) | Yes | Selling the model is not permitted. |
| iLLMyth Dark Lines v2, AddMicroDetails Illustrious v6 (LoRAs) | CivitAI creators | Illustrious License (FAIPL 1.0-SD) | Yes | No credit required. |
| **Anima Aesthetic v1.1** + Anima Myth Dark Lines LoRA | CircleStone Labs | **CircleStone Labs Non-Commercial License v1.2** + NVIDIA Open Model License | Outputs yes; **the model is non-commercial**: powering a feature of a monetized product is not permitted without a commercial licence | Notice on distribution: "The CircleStone Model is licensed by CircleStone Labs LLC under the CircleStone Non-Commercial License. Copyright CircleStone Labs LLC." Qwen3-0.6B encoder and Qwen-Image VAE: Apache-2.0. |
| Illustrious-XL v2.0 (listed, no pipeline) | OnomaAI | CreativeML OpenRAIL-M (HF card) / Illustrious License (CivitAI) | Yes | Sources disagree; not offered by any pipeline. |
| CyberRealistic XL, NovaAnimeXL IL (listed, no pipeline) | CivitAI creators | CreativeML Open RAIL++-M; Illustrious License | Yes | Not offered by any pipeline. |

Every forge output (PNG, MP4) carries an AI-generated disclosure in its own
metadata (`backend/services/image-forge/ai-disclosure.js`); the prompt and
workflow are stripped.

## Platform marks (desk icons for the outreach platforms)

| Marks | Source | Licence | Notes |
| ----- | ------ | ------- | ----- |
| X, Telegram, Discord, Facebook, Mastodon, Bluesky | Simple Icons 16.35.0 | CC0 1.0 (the SVG paths) | Drawn single-colour in `frontend/app/RelinkShell/brand-marks.jsx`. |
| LinkedIn "in" | drawn in-house (absent from Simple Icons) | — | Same file. |

Each logo remains the trademark of its owner. The desk shows a mark only to
name the platform a window speaks through; no endorsement is implied.
