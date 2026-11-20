const { createConfirmWindow } = require('./confirm-window.cjs');
const { buildGateView, buildSecretView } = require('./confirm-view.cjs');
const { createSecretGate } = require('./secret-gate.cjs');

const gateDialog = (getWindow, spec) => createConfirmWindow(getWindow(), buildGateView(spec));

/**
 * impure — the secret gate over the real trusted windows (secret-gate.cjs).
 * @param {() => object} getWindow - the desk that asked
 */
const secretGate = (getWindow) => createSecretGate({
  ask: (spec) => gateDialog(getWindow, spec),
  show: (spec) => createConfirmWindow(getWindow(), buildSecretView(spec)),
});

module.exports = { gateDialog, secretGate };
