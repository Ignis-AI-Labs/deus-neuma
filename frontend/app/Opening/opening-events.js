// opening-events.js — the opening's timing signals. Pure constants.
//
// The startup (THE IGNITION), the gateway's field, the Portal and the desk's
// Arrival are surfaces of one opening; these events are the contract between them.

export const OPENING_EVENTS = Object.freeze({
  // Portal.openPortal: the witness crossed the threshold — the field exits.
  PORTAL_OPENING: 'portal:opening',
  // The deferred Arrival, per real portal stage (detail: { stage,
  // resumeExpected }) — the ignition shows them as its BEING / SESSION instruments.
  ARRIVAL: 'opening:arrival',
  // THE IGNITION has yielded (or opened): the gateway's armillary, resting
  // beneath it in the same pose, may begin to turn.
  IGNITION_DONE: 'opening:ignition-done',
  // The boot has handed the screen over (opening-state.setBootActive(false)).
  BOOT_DONE: 'opening:boot-done',
});
