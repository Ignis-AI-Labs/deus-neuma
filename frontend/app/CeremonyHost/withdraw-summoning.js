/** Start one correlated withdrawal; cleanup never interprets silence as success. // impure */
export const withdrawSummoning = (wsService, sessionId, onResult, timeoutMs = 8000) => {
  const requestId = crypto.randomUUID();
  let active = true;
  let timer;
  const cleanup = () => {
    active = false;
    clearTimeout(timer);
    wsService.off('birth:abandoned', acknowledged);
    wsService.off('birth:abandon_refused', refused);
    wsService.off('disconnection', disconnected);
    wsService.off('portal:error', failed);
  };
  const finish = (result) => {
    if (!active) return;
    cleanup();
    onResult(result);
  };
  const matches = (data) => data?.sessionId === sessionId && data?.requestId === requestId;
  const acknowledged = (data) => { if (matches(data)) finish({ ok: true }); };
  const refused = (data) => { if (matches(data)) finish({ ok: false,
    message: data.message || 'The existing summoning must be continued.' }); };
  const disconnected = () => finish({ ok: false, message: 'Connection lost. Withdrawal was not confirmed; the checkpoint remains displayed.' });
  const failed = () => finish({ ok: false, message: 'Withdrawal was not confirmed. Review the existing summoning before trying again.' });
  wsService.on('birth:abandoned', acknowledged);
  wsService.on('birth:abandon_refused', refused);
  wsService.on('disconnection', disconnected);
  wsService.on('portal:error', failed);
  timer = setTimeout(() => finish({ ok: false,
    message: 'No withdrawal acknowledgement arrived. The existing summoning remains displayed.' }), timeoutMs);
  if (!wsService.isConnected) disconnected();
  else {
    try { wsService.send('birth:abandon', { sessionId, requestId }); }
    catch { failed(); }
  }
  return cleanup;
};
