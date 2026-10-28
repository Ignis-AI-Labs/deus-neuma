// common — the shared atoms every surface reuses (toggles, act buttons).
// en is the source catalog: values are the strings the UI already renders,
// verbatim, so every string-pinned test and e2e locator stands unchanged.

export default Object.freeze({
  on: 'ON',
  off: 'OFF',
  set: 'SET',
  saved: 'SAVED',
  trainingNotice: Object.freeze({
    title: "TURN OFF TRAINING ON YOUR DATA",
    body: "Anything you send to {{provider}} leaves your machine. Before you send anything, open the privacy or data settings of your {{provider}} account and turn off every option that lets them use your conversations to train their models. Some providers leave it on by default — check each account and plan you use.",
  }),
  textSize: Object.freeze({
    open: 'Text size',
    title: 'TEXT SIZE',
    smaller: 'Smaller text',
    larger: 'Larger text',
    reset: 'RESET',
  }),
});
