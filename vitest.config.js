import { defineConfig } from 'vitest/config';

// Live tests exercise shared external substrate (the local inference server,
// live channels). Run concurrently they starve each other — capacity-scan
// deliberately saturates every inference slot while birth/portal tests are
// mid-stream, turning real passes into timeout reds. They get their own
// single-fork lane (serial among themselves); everything else stays parallel.
const LIVE_TESTS = [
  'test/integration/*-live.test.js',
  'test/integration/substrate-*.test.js',
  // Not "-live" by name, but they stream the real model too — measured as
  // the top substrate consumers in full-suite runs (team-route alone held
  // slots for ~18 minutes in parallel, starving the whole live lane).
  'test/integration/team-route.test.js',
  // Same live-gnosis gate as team-route (its sibling), but it was left in the
  // PARALLEL lane — and its gate is `describe.skipIf(!canRunLive)` where
  // canRunLive is just […]. That is presence-as-
  // consent: on the witness's rig a serving substrate is the normal state, so
  // every casual suite run fired real turns beside everything else. Same law
  // as test/helpers/gpu-optin.js — it rides the serial lane with its sibling.
  'test/integration/team-run-tool.test.js',
  'test/integration/stream-interrupt.test.js',
  'test/integration/stream-model-resolution.test.js',
  'test/integration/llm-providers.test.js',
  'test/integration/continuity-semantic.test.js',
  // Streams the machine substrate for its live-summarizer consolidation leg
  // (was misfiled in the parallel suite gated on a dishonest ":1234 answers"
  // probe — llmster's daemon answers with zero models loaded, so the test ran
  // against an empty server and died on the error body, 2026-07-11).
  'test/integration/continuity-workspace-adapter.test.js',
  // Launches the REAL whisper sidecar on the GPU (uv + downloaded weights,
  // provisioned per box and gitignored) — substrate-class by nature: it
  // contends for VRAM with a serving model, and a fresh checkout has no
  // weights to load. Rides the serial live lane with the other substrate
  // consumers so the default suite stays green on any clone.
  'test/integration/stt-transcribe.test.js',
  // GPU-ENGINE suites (Xid 79, 2026-07-24: the GPU fell off the bus —
  // "Node Reboot Required" — minutes after a parallel full-suite run lit a
  // real SDXL generation beside the serving substrate). These light REAL
  // engines (ComfyUI) or drive real synthesis on a sidecar that happens to
  // be up — they run serially HERE, and only when explicitly summoned
  // (RUN_GPU_ENGINE_TESTS=1; test/helpers/gpu-optin.js). Presence is not
  // consent: the parallel suite must be UNABLE to touch the GPU.
  'test/integration/image-forge-job-lane.test.js',
  'test/integration/comfyui-supervisor.test.js',
  'test/integration/api-voice-engine-audition.test.js',
  'test/integration/api-voice-forge-e2e.test.js',
  'test/integration/api-voice-e2e.test.js',
];

export default defineConfig({
  // Frontend components under test (e.g. Markdown.jsx via react-dom/server)
  // use the modern JSX runtime — same as the Vite app build.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['test/setup.js'],
    testTimeout: 15000,
    projects: [
      {
        extends: true,
        test: {
          name: 'suite',
          include: [
            'test/unit/**/*.test.js',
            'test/integration/**/*.test.js',
          ],
          exclude: ['test/test-*.js', ...LIVE_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'substrate-live',
          include: LIVE_TESTS,
          // Serial (one file at a time — they share the substrate's slots)
          // but each file still gets its own fresh fork: singleFork would
          // bleed module state (config singletons, portals) across files.
          fileParallelism: false,
          // Live tests prove the REAL serving path, so they boot the real
          // machine config exactly like server.js (dotenv → loadConfig) —
          // otherwise llm-provider silently falls back to lm-studio:1234,
          // which by serving law never has a model loaded. Live lane ONLY:
          // the hermetic suite stays config-less on purpose.
          setupFiles: ['test/setup.js', 'test/helpers/live-machine-config.js'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: [
        'core/**/*.js',
        'backend/routes/**/*.js',
        'backend/services/**/*.js',
        'backend/utils/**/*.js',
        'backend/middleware/**/*.js'
      ],
      exclude: [
        'backend/services/supabase.js'
      ],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60
      },
      reporter: ['text', 'text-summary', 'html']
    }
  }
});
