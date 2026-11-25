// Give Electron's UtilityProcess the small Node-child surface the existing launch consumers use.
// impure — attaches one exit listener and defines the compatibility methods on the real child.
const asNodeChild = (child) => {
  let connected = true;
  child.once('exit', () => { connected = false; });
  Object.defineProperty(child, 'connected', { configurable: true, get: () => connected });
  child.send = (message, callback) => {
    if (!connected) {
      if (typeof callback === 'function') queueMicrotask(() => callback(new Error('backend utility process is not connected')));
      return;
    }
    try {
      child.postMessage(message);
      if (typeof callback === 'function') queueMicrotask(() => callback(null));
    } catch (error) {
      if (typeof callback !== 'function') throw error;
      queueMicrotask(() => callback(error));
    }
  };
  return child;
};

module.exports = { asNodeChild };
