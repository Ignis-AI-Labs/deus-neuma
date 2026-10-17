// Pure vocabulary: UI intent → ratified manifest event (sound-manifest.js,
// locked by Founder's ear). One place to remap; no IO — the Web Audio boundary
// lives in ui-sound.js / sound-engine.js.
//
// Intents:
//   activate — a primary action fires (confirm, submit, run)
//   open     — something appears (window, menu, layer)
//   close    — something dismisses (cancel, back, dismiss)
//   deny     — a refusal, stop, or destructive act
//   toggle   — a state flips (mute, mode, expand)
//   tick     — lightweight selection/navigation movement

export const UI_SOUND = Object.freeze({
  activate: 'confirm',
  open: 'menuOpen',
  close: 'menuClose',
  deny: 'deny',
  toggle: 'deliberationTick',
  tick: 'deliberationTick',
});
