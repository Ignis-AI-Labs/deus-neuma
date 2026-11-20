const crypto = require('node:crypto');

const REQUEST = 'neuma:wallet-bridge';
const RESULT = 'neuma:wallet-bridge-result';
let backend = null;
const pending = new Map();

const registerWalletBridgeBackend = (child) => {
  backend = child;
  const receive = (message) => {
    if (message?.type !== RESULT || typeof message.requestId !== 'string') return;
    const waiter = pending.get(message.requestId);
    if (!waiter) return;
    pending.delete(message.requestId);
    clearTimeout(waiter.timer);
    waiter.resolve(message.result);
  };
  child.on('message', receive);
  child.once('exit', () => {
    child.off('message', receive);
    if (backend === child) backend = null;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('The desktop backend stopped during wallet handoff.'));
    }
    pending.clear();
  });
};

const request = (action, payload = {}) => new Promise((resolve, reject) => {
  if (!backend?.connected) return reject(new Error('The desktop wallet bridge is unavailable.'));
  const requestId = crypto.randomUUID();
  const timer = setTimeout(() => {
    pending.delete(requestId);
    reject(new Error('The desktop wallet bridge timed out.'));
  }, 10000);
  pending.set(requestId, { resolve, reject, timer });
  backend.send({ type: REQUEST, requestId, action, ...payload }, (error) => {
    if (!error) return;
    clearTimeout(timer);
    pending.delete(requestId);
    reject(error);
  });
});

const startWalletBridge = () => request('start');
const pollWalletBridge = (browserCode, pollSecret) => request('poll', { browserCode, pollSecret });

const registerWalletBridgeIpc = ({ ipcMain, isDesk }) => {
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!isDesk(event)) throw new Error(`${channel} refused: not the desk`);
    return fn(...args);
  });
  handle('walletBridge:start', startWalletBridge);
  handle('walletBridge:poll', pollWalletBridge);
};

module.exports = { registerWalletBridgeBackend, registerWalletBridgeIpc, startWalletBridge, pollWalletBridge };
