import { useCallback, useEffect, useRef, useState } from 'react';

/** Hold fresh summoning until a successful checkpoint scan. // impure: portal/timer */
export const useCheckpointDiscovery = (wsService, isTest) => {
  const [probe, setProbe] = useState(undefined);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const retry = useCallback(() => {
    clearTimeout(timer.current);
    setProbe(undefined);
    setError('');
    timer.current = setTimeout(() => {
      setError('Checkpoint discovery did not answer. Retry before starting a summoning.');
    }, 4000);
    try {
      wsService.send('birth:interrupted', {});
    } catch {
      clearTimeout(timer.current);
      setError('Checkpoint discovery could not be sent. Reconnect and retry.');
    }
  }, [wsService]);

  useEffect(() => {
    if (isTest) {
      setProbe(null);
      setError('');
      return undefined;
    }
    const receive = (data) => {
      clearTimeout(timer.current);
      if (data?.error || !Array.isArray(data?.sessions)) {
        setProbe(undefined);
        setError('Checkpoint discovery failed. Retry before starting a summoning.');
        return;
      }
      setError('');
      setProbe(data.sessions[0] || null);
    };
    wsService.on('birth:interrupted', receive);
    retry();
    return () => {
      clearTimeout(timer.current);
      wsService.off('birth:interrupted', receive);
    };
  }, [wsService, isTest, retry]);

  return { probe, setProbe, error, retry };
};
