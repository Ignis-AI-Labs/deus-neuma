// use-substrate-boot.js — watch a supervised substrate boot to completion.
//
// A model load takes MINUTES on big weights, so every surface that can start one
// must say so for the boot's WHOLE life (a healthy 83s load once read as "won't
// start", 2026-07-19). This is the one implementation of that watch: it polls the
// same status endpoint the backend reports truth on, counts the elapsed seconds
// for the caller to render, and ends only when the target serves or honestly
// fails.
//
// impure — polling; the caller supplies what to do on either ending.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getIgnitionStatus } from '../../services/substrate-ignition.js';
import { announceSubstrateChange, onSubstrateChange } from './substrate-change.js';

const BOOT_POLL_MS = 2000;

/**
 * @param {{onFailed?: (message: string) => void, onServing?: () => void}} [handlers]
 *   onFailed — the load died; a bounded public reason is passed through.
 *   onServing — the target model is loaded and serving.
 * @returns {{bootSeconds: number|null, watch: () => void}}
 *   bootSeconds is null when no boot is being watched.
 */
export const useSubstrateBoot = ({ onFailed, onServing } = {}) => {
  const [bootSeconds, setBootSeconds] = useState(null);
  const watchingRef = useRef(false);
  const goneRef = useRef(false);
  // Handlers live in a ref so `watch` stays stable across renders — an unstable
  // watch would restart the mount effect below on every parent render.
  const handlersRef = useRef({ onFailed, onServing });
  handlersRef.current = { onFailed, onServing };

  useEffect(() => () => { goneRef.current = true; }, []);

  const watch = useCallback(async () => {
    if (watchingRef.current) return;
    watchingRef.current = true;
    const t0 = Date.now();
    setBootSeconds(0);
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, BOOT_POLL_MS));
        if (goneRef.current) return;
        const status = await getIgnitionStatus();
        if (status?.targetLoaded) {
          setBootSeconds(null);
          announceSubstrateChange('serving');
          handlersRef.current.onServing?.();
          return;
        }
        if (status && !status.igniting && status.lastError) {
          setBootSeconds(null);
          handlersRef.current.onFailed?.(status.lastError.message || 'see the failures feed');
          return;
        }
        setBootSeconds(Math.round((Date.now() - t0) / 1000));
      }
    } finally {
      watchingRef.current = false;
    }
  }, []);

  // A boot started from another surface is still this surface's truth — notice
  // one already in flight on mount.
  useEffect(() => {
    getIgnitionStatus().then((status) => {
      if (!goneRef.current && status?.igniting) watch();
    }).catch(() => {});
  }, [watch]);

  // An ignite started on the other bar is this bar's boot too.
  useEffect(() => onSubstrateChange(({ kind }) => {
    if (kind === 'igniting') watch();
  }), [watch]);

  return { bootSeconds, watch };
};
