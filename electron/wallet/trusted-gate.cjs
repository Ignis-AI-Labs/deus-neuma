const { createConfirmWindow } = require('./confirm-window.cjs');
const { buildGateView } = require('./confirm-view.cjs');

const gateDialog = (getWindow, spec) => createConfirmWindow(getWindow(), buildGateView(spec));

module.exports = { gateDialog };
