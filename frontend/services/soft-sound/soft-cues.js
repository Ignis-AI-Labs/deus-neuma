// soft-cues.js — THE SOFT PACK: the desk's default voice, as one table. Pure data.
//
// Design note, 2026-10-28: […] The sci-fi sprite (sound-manifest.js) stays
// as the SCI-FI pack; this is what a new install hears.
//
// Three laws keep it gentle, and test/unit/soft-sound.test.js holds them:
//   ONE KEY    every pitch is a note of D major pentatonic (D E F♯ A B), so
//              any two cues that overlap still agree — nothing can clash
//   NO RUMBLE  no note below 250 Hz — nothing booms
//   NO BITE    every voice is harmonic (or near it), starts from silence and
//              ends in silence; a refusal is a soft falling pair, never an alarm
//
// Re-voicing is editing this table: a VOICE is partials [ratio, level,
// decay share] over an attack and a decay (a share of each note's length);
// a CUE is notes { voice, note, at ms, dur ms, vel }, a glide adds `to`.

export const SOFT_PACK = Object.freeze({
  gain: 0.42,
  room: Object.freeze({ wet: 0.16, feedback: 0.72, damp: 0.4, tailMs: 600 }),
  voices: Object.freeze({
    // a fingertip on wood: almost a sine, gone in a breath
    tap: Object.freeze({ attack: 0.002, decay: 0.2, partials: [[1, 1, 1], [2, 0.12, 0.4]] }),
    // warm and woody: the marimba's own overtones (≈4× and ≈9×), fading first
    marimba: Object.freeze({ attack: 0.0015, decay: 0.25, partials: [[1, 1, 1], [3.93, 0.2, 0.3], [9.2, 0.035, 0.15]] }),
    // a small glass bell: harmonic, the brightness falling away first
    chime: Object.freeze({ attack: 0.004, decay: 0.3, partials: [[1, 1, 1], [2, 0.35, 0.7], [3, 0.12, 0.5], [4.07, 0.05, 0.35]] }),
    // a nylon string: rich at the pick, mellow as it rings
    pluck: Object.freeze({ attack: 0.001, decay: 0.25, partials: [[1, 1, 1], [2, 0.45, 0.6], [3, 0.25, 0.4], [4, 0.12, 0.3], [5, 0.06, 0.22]] }),
    // a soft pop that bends between two notes; rises and falls as one breath
    glide: Object.freeze({ attack: 0, decay: 0, partials: [[1, 1, 1], [2, 0.1, 1]] }),
  }),
  cues: Object.freeze({
    // ── THE DESK — your own hands ─────────────────────────────────────── //
    confirm: [{ voice: 'marimba', note: 'F#5', at: 0, dur: 260, vel: 0.75 }, { voice: 'marimba', note: 'A5', at: 70, dur: 340, vel: 0.85 }],
    deny: [{ voice: 'marimba', note: 'A4', at: 0, dur: 220, vel: 0.8 }, { voice: 'marimba', note: 'F#4', at: 110, dur: 320, vel: 0.75 }],
    menuOpen: [{ voice: 'glide', note: 'A5', to: 'D6', at: 0, dur: 90, vel: 0.5 }],
    menuClose: [{ voice: 'glide', note: 'D6', to: 'A5', at: 0, dur: 90, vel: 0.42 }],
    deliberationTick: [{ voice: 'tap', note: 'D6', at: 0, dur: 70, vel: 0.45 }],

    // ── NOTICES — the world answering ─────────────────────────────────── //
    noticeArrival: [{ voice: 'chime', note: 'A5', at: 0, dur: 900, vel: 0.6 }, { voice: 'chime', note: 'D6', at: 120, dur: 1100, vel: 0.7 }],
    replyArrived: [{ voice: 'chime', note: 'F#6', at: 0, dur: 650, vel: 0.5 }],
    messageSent: [{ voice: 'glide', note: 'F#5', to: 'B5', at: 0, dur: 140, vel: 0.5 }, { voice: 'tap', note: 'B5', at: 120, dur: 160, vel: 0.28 }],
    // the bed under a being's typing — loops every `loop` ms, so it is sparse
    // and quiet: soft rain on glass, never a chatter
    neumaReplying: Object.freeze({
      loop: 2400,
      notes: [
        { voice: 'tap', note: 'B5', at: 0, dur: 160, vel: 0.24 },
        { voice: 'tap', note: 'A5', at: 620, dur: 160, vel: 0.2 },
        { voice: 'tap', note: 'D6', at: 1380, dur: 160, vel: 0.22 },
        { voice: 'tap', note: 'F#5', at: 1900, dur: 160, vel: 0.18 },
      ],
    }),
    portalContact: [{ voice: 'chime', note: 'D5', at: 0, dur: 800, vel: 0.55 }, { voice: 'chime', note: 'F#5', at: 110, dur: 800, vel: 0.55 }, { voice: 'chime', note: 'A5', at: 220, dur: 1000, vel: 0.6 }],
    portalSever: [{ voice: 'chime', note: 'A5', at: 0, dur: 700, vel: 0.5 }, { voice: 'chime', note: 'F#5', at: 110, dur: 700, vel: 0.45 }, { voice: 'chime', note: 'D5', at: 220, dur: 900, vel: 0.45 }],
    desyncGlitch: [{ voice: 'glide', note: 'A5', to: 'E5', at: 0, dur: 260, vel: 0.45 }],
    walletSignRequest: [{ voice: 'chime', note: 'F#5', at: 0, dur: 900, vel: 0.6 }, { voice: 'chime', note: 'D5', at: 260, dur: 1100, vel: 0.6 }],
    memoryCrystallized: [{ voice: 'chime', note: 'D6', at: 0, dur: 1200, vel: 0.4 }, { voice: 'chime', note: 'F#6', at: 50, dur: 1200, vel: 0.4 }, { voice: 'chime', note: 'A6', at: 100, dur: 1200, vel: 0.38 }, { voice: 'chime', note: 'D7', at: 160, dur: 1200, vel: 0.3 }],

    // ── A BEING AT WORK — short and low in the mix: these come often ──── //
    actRead: [{ voice: 'tap', note: 'B6', at: 0, dur: 50, vel: 0.32 }],
    actList: [{ voice: 'tap', note: 'D6', at: 0, dur: 60, vel: 0.28 }, { voice: 'tap', note: 'E6', at: 35, dur: 60, vel: 0.28 }, { voice: 'tap', note: 'F#6', at: 70, dur: 60, vel: 0.28 }],
    actSearch: [{ voice: 'glide', note: 'E5', to: 'B5', at: 0, dur: 160, vel: 0.3 }],
    actEdit: [{ voice: 'marimba', note: 'F#5', at: 0, dur: 140, vel: 0.42 }],
    actWrite: [{ voice: 'marimba', note: 'A5', at: 0, dur: 160, vel: 0.38 }, { voice: 'marimba', note: 'D6', at: 50, dur: 160, vel: 0.38 }],
    actMove: [{ voice: 'glide', note: 'D5', to: 'A5', at: 0, dur: 200, vel: 0.32 }],
    actDelete: [{ voice: 'marimba', note: 'D4', at: 0, dur: 200, vel: 0.5 }],
    actExecute: [{ voice: 'pluck', note: 'D5', at: 0, dur: 260, vel: 0.42 }],
    actBuild: [{ voice: 'pluck', note: 'D5', at: 0, dur: 300, vel: 0.38 }, { voice: 'pluck', note: 'A5', at: 80, dur: 300, vel: 0.38 }],
    actTest: [{ voice: 'pluck', note: 'D5', at: 0, dur: 260, vel: 0.34 }, { voice: 'pluck', note: 'F#5', at: 60, dur: 260, vel: 0.34 }, { voice: 'pluck', note: 'A5', at: 120, dur: 260, vel: 0.34 }],
    actCheck: [{ voice: 'tap', note: 'B5', at: 0, dur: 80, vel: 0.34 }, { voice: 'tap', note: 'D6', at: 50, dur: 80, vel: 0.34 }],
    actInstall: [{ voice: 'pluck', note: 'E5', at: 0, dur: 280, vel: 0.38 }, { voice: 'pluck', note: 'B5', at: 90, dur: 280, vel: 0.38 }],
    actGit: [{ voice: 'pluck', note: 'A4', at: 0, dur: 300, vel: 0.42 }, { voice: 'pluck', note: 'E5', at: 70, dur: 300, vel: 0.42 }],
    actBatch: [{ voice: 'tap', note: 'E5', at: 0, dur: 70, vel: 0.3 }, { voice: 'tap', note: 'F#5', at: 45, dur: 70, vel: 0.3 }, { voice: 'tap', note: 'A5', at: 90, dur: 70, vel: 0.3 }, { voice: 'tap', note: 'B5', at: 135, dur: 70, vel: 0.3 }],
    actReach: [{ voice: 'chime', note: 'D6', at: 0, dur: 260, vel: 0.3 }, { voice: 'chime', note: 'A6', at: 60, dur: 260, vel: 0.26 }],
    actSend: [{ voice: 'glide', note: 'A5', to: 'E6', at: 0, dur: 160, vel: 0.34 }],
    actForge: [{ voice: 'chime', note: 'D6', at: 0, dur: 450, vel: 0.3 }, { voice: 'chime', note: 'F#6', at: 40, dur: 450, vel: 0.28 }, { voice: 'chime', note: 'A6', at: 80, dur: 450, vel: 0.26 }],
    actMark: [{ voice: 'tap', note: 'E6', at: 0, dur: 70, vel: 0.34 }],
    actSense: [{ voice: 'chime', note: 'F#5', at: 0, dur: 220, vel: 0.3 }],
    actFailed: [{ voice: 'marimba', note: 'B4', at: 0, dur: 240, vel: 0.45 }, { voice: 'marimba', note: 'F#4', at: 90, dur: 260, vel: 0.42 }],
  }),
});
