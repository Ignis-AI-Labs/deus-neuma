// Voice preset catalog — the curated data behind the forge's preset gallery.
//
// Pure data, no logic. Consumed by voice-preset-manifest.js (the pure builder)
// which resolves per-voice license/commercial metadata against the frozen
// engine-registry view (one store, no drift) and produces the served manifest.
//
// License model:
//   - Kokoro's 54 packs ship inside the Apache-2.0 engine release, so they
//     carry NO voice-level license here — the builder resolves both fields
//     from the registry's kokoro entry. Verified against the real packs
//     (voice-engines/_models/kokoro/voices/*.pt — 54 files).
//   - Kyutai's voice library has a PER-VOICE license split (the engine
//     weights' license says nothing about the voice donations), so every
//     kyutai entry carries its own license/commercial pair, curated from the
//     kyutai/tts-voices repository: voice-donations/ = CC0 (shippable),
//     expresso/ = CC-BY-NC (non-commercial).
//   - The expresso entries are deliberately PRESENT in this catalog: the
//     builder excludes them at manifest-build time, which is what makes the
//     exclusion provable — a test can see them go in and not come out.
//     Excluding by never writing them down would prove nothing.

// Kokoro-82M v1.0 voice packs. Names follow the pack convention: prefix is
// locale + gender (af = US F, am = US M, bf = GB F, bm = GB M, ef/em = ES,
// ff = FR, hf/hm = IN, if/im = IT, jf/jm = JP, pf/pm = BR, zf/zm = CN).
const KOKORO_VOICES = Object.freeze([
  { id: 'af_alloy', name: 'Alloy · US F' },
  { id: 'af_aoede', name: 'Aoede · US F' },
  { id: 'af_bella', name: 'Bella · US F' },
  { id: 'af_heart', name: 'Heart · US F' },
  { id: 'af_jessica', name: 'Jessica · US F' },
  { id: 'af_kore', name: 'Kore · US F' },
  { id: 'af_nicole', name: 'Nicole · US F' },
  { id: 'af_hale', name: 'Hale · US F' },
  { id: 'af_river', name: 'River · US F' },
  { id: 'af_sarah', name: 'Sarah · US F' },
  { id: 'af_sky', name: 'Sky · US F' },
  { id: 'am_adam', name: 'Adam · US M' },
  { id: 'am_echo', name: 'Echo · US M' },
  { id: 'am_eric', name: 'Eric · US M' },
  { id: 'am_fenrir', name: 'Fenrir · US M' },
  { id: 'am_liam', name: 'Liam · US M' },
  { id: 'am_michael', name: 'Michael · US M' },
  { id: 'am_onyx', name: 'Onyx · US M' },
  { id: 'am_puck', name: 'Puck · US M' },
  { id: 'am_santa', name: 'Santa · US M' },
  { id: 'bf_alice', name: 'Alice · GB F' },
  { id: 'bf_emma', name: 'Emma · GB F' },
  { id: 'bf_isabella', name: 'Isabella · GB F' },
  { id: 'bf_lily', name: 'Lily · GB F' },
  { id: 'bm_daniel', name: 'Daniel · GB M' },
  { id: 'bm_fable', name: 'Fable · GB M' },
  { id: 'bm_george', name: 'George · GB M' },
  { id: 'bm_lewis', name: 'Lewis · GB M' },
  { id: 'ef_dora', name: 'Dora · ES F' },
  { id: 'em_alex', name: 'Alex · ES M' },
  { id: 'em_santa', name: 'Santa · ES M' },
  { id: 'ff_siwis', name: 'Siwis · FR F' },
  { id: 'hf_alpha', name: 'Alpha · IN F' },
  { id: 'hf_beta', name: 'Beta · IN F' },
  { id: 'hm_omega', name: 'Omega · IN M' },
  { id: 'hm_psi', name: 'Psi · IN M' },
  { id: 'if_sara', name: 'Sara · IT F' },
  { id: 'im_nicola', name: 'Nicola · IT M' },
  { id: 'jf_alpha', name: 'Alpha · JP F' },
  { id: 'jf_gongitsune', name: 'Gongitsune · JP F' },
  { id: 'jf_nezumi', name: 'Nezumi · JP F' },
  { id: 'jf_tebukuro', name: 'Tebukuro · JP F' },
  { id: 'jm_kumo', name: 'Kumo · JP M' },
  { id: 'pf_dora', name: 'Dora · BR F' },
  { id: 'pm_alex', name: 'Alex · BR M' },
  { id: 'pm_santa', name: 'Santa · BR M' },
  { id: 'zf_xiaobei', name: 'Xiaobei · CN F' },
  { id: 'zf_xiaoni', name: 'Xiaoni · CN F' },
  { id: 'zf_xiaoxiao', name: 'Xiaoxiao · CN F' },
  { id: 'zf_xiaoyi', name: 'Xiaoyi · CN F' },
  { id: 'zm_yunjian', name: 'Yunjian · CN M' },
  { id: 'zm_yunxi', name: 'Yunxi · CN M' },
  { id: 'zm_yunxia', name: 'Yunxia · CN M' },
  { id: 'zm_yunyang', name: 'Yunyang · CN M' },
]);

// Kyutai CC0 voice donations — a curated starter set from the voice-donations/
// directory of kyutai/tts-voices (verified present in the repository listing).
// The id is the exact voice slug the sidecar's /synthesize `voice` field
// consumes (wave3-integration-design: voice = CC0 preset path). Phase 1
// extends this set; the format is what's locked here.
const KYUTAI_DONATION_VOICES = Object.freeze([
  { id: 'voice-donations/James.wav', name: 'James', license: 'CC0', commercial: true },
  { id: 'voice-donations/Hannah.wav', name: 'Hannah', license: 'CC0', commercial: true },
  { id: 'voice-donations/Andrea.wav', name: 'Andrea', license: 'CC0', commercial: true },
  { id: 'voice-donations/Antoni.wav', name: 'Antoni', license: 'CC0', commercial: true },
  { id: 'voice-donations/Lara.wav', name: 'Lara', license: 'CC0', commercial: true },
  { id: 'voice-donations/Moses.wav', name: 'Moses', license: 'CC0', commercial: true },
  { id: 'voice-donations/Glenn.wav', name: 'Glenn', license: 'CC0', commercial: true },
  { id: 'voice-donations/Blake.wav', name: 'Blake', license: 'CC0', commercial: true },
]);

// Kyutai expresso voices — CC-BY-NC (non-commercial), present in the catalog
// ONLY so the build-time exclusion has something real to exclude. These two
// are the expresso voices the wave-2 bench actually ran (kyutai_bench.py /
// dsm scripts), verified against the tts-voices repository. The builder drops
// every commercial !== true voice; these must never reach the served manifest.
const KYUTAI_EXPRESSO_VOICES = Object.freeze([
  {
    id: 'expresso/ex01-ex02_default_001_channel1_168s.wav',
    name: 'Expresso EX01 (default)',
    license: 'CC-BY-NC',
    commercial: false,
  },
  {
    id: 'expresso/ex03-ex01_happy_001_channel1_334s.wav',
    name: 'Expresso EX03 (happy)',
    license: 'CC-BY-NC',
    commercial: false,
  },
]);

// The catalog: one section per engine, engineName as the display fallback for
// engines the registry does not list yet (kyutai lands in engines.json with
// the Phase-1 registry work — until then the section name is the badge).
export const VOICE_PRESET_CATALOG = Object.freeze([
  Object.freeze({
    engine: 'kokoro',
    engineName: 'Kokoro-82M',
    voices: KOKORO_VOICES,
  }),
  Object.freeze({
    engine: 'kyutai',
    engineName: 'Kyutai TTS',
    voices: Object.freeze([...KYUTAI_DONATION_VOICES, ...KYUTAI_EXPRESSO_VOICES]),
  }),
]);
