import { startBridgeSession, retrieveBridgeToken } from './auth-bridge.js';

const REQUEST = 'neuma:wallet-bridge';
const RESULT = 'neuma:wallet-bridge-result';

export const installWalletBridgeIpc = () => {
  if (typeof process.send !== 'function') return () => {};
  const receive = (message) => {
    if (message?.type !== REQUEST || typeof message.requestId !== 'string' || message.requestId.length > 80) return;
    let result;
    if (message.action === 'start') result = startBridgeSession();
    else if (message.action === 'poll') result = retrieveBridgeToken(message.browserCode, message.pollSecret);
    else return;
    process.send({ type: RESULT, requestId: message.requestId, result });
  };
  process.on('message', receive);
  return () => process.off('message', receive);
};
