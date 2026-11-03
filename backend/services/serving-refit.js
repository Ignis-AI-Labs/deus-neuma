import {
  startSupervised, stopSupervised, supervisorStatus,
} from './llama-server-supervisor.js';
import { substrateBusy } from './substrate-lifecycle.js';
import { expireRuntimeModelCaches } from './llm-provider.js';
import { markActivity } from './substrate-idle.js';
import { saveServingShare } from './serving-fit.js';
import { createLogger } from './logger.js';

const log = createLogger('ServingRefit');
let refitInflight = false;

/**
 * Impure — save the operator's share and restart the SAME supervised server so
 * fittedLaunch measures a new pool. The context flag cannot change in place.
 * No selection or provider changes; no second server or port.
 */
export const refitServing = async (launchCfg, sharePct) => {
  if (refitInflight) return { status: 'busy', reason: 'relaunch-in-flight' };
  refitInflight = true;
  const refuse = (status) => {
    refitInflight = false;
    return { status };
  };
  try {
    const state = await supervisorStatus(launchCfg);
    if (state.serving && !state.owned) return refuse('unowned');
    if (state.serving && await substrateBusy(launchCfg)) return refuse('busy');
    const savedShare = saveServingShare(sharePct);
    markActivity();
    expireRuntimeModelCaches();
    const boot = (async () => {
      if (state.serving || state.booting) await stopSupervised();
      return startSupervised(launchCfg);
    })();
    boot.then((result) => {
      refitInflight = false;
      log.info('same-server context refit settled', result);
    }).catch((err) => {
      refitInflight = false;
      log.error('same-server context refit failed', { err: err.message });
    });
    return { status: 'igniting', sharePct: savedShare };
  } catch (err) {
    refitInflight = false;
    throw err;
  }
};
