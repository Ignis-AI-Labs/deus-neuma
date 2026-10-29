/**
 * Substrate idle tracker — graceful hardware return.
 *
 * Records the moment of the last inference and, on a timer, unloads a
 * backend-supervised substrate that has gone idle — freeing VRAM/host RAM — to
 * be reloaded on the next summon (llm-provider ensures serving before it
 * streams). This is the […] half of the
 * lifecycle: the supervisor can stop the process, and this decides WHEN.
 *
 * Kept dependency-light (only the logger) so llm-provider can import
 * markActivity without an import cycle. The decision is a pure function; the
 * monitor's checks + unload are INJECTED so this module owns no substrate deps.
 */
import { createLogger } from './logger.js';

const log = createLogger('SubstrateIdle');

let lastActivityAt = Date.now();
// The moment the monitor DELIBERATELY unloaded the substrate for rest (ISO),
// or null while it is resident / down for any other reason. This is the
// truth that lets the health payload say STANDBY instead of OFFLINE: a
// deliberate unload is the one down-state that is not a failure.
let standbySince = null;

/** Record an inference — the idle clock restarts from here, and any
 *  deliberate rest is over (a summon woke the substrate). Impure (clock). */
export const markActivity = () => { lastActivityAt = Date.now(); standbySince = null; };

/** The idle clock's current anchor — observable for status + proof. Impure (reads clock state). */
export const lastActivity = () => lastActivityAt;

/**
 * The deliberate-rest truth for the health payload: `standby` is true only
 * when the idle monitor itself put the substrate to bed and nothing has
 * summoned it awake since (markActivity clears the mark). `standby: false`
 * says nothing about WHY the substrate is down — crash, never booted, or a
 * manual stop all read the same, and keep OFFLINE's honest meaning.
 * Impure (reads module state).
 * @returns {{standby: boolean, since: string|null}}
 */
export const deliberateStandby = () => ({ standby: standbySince !== null, since: standbySince });

/**
 * Should the supervised substrate be unloaded right now? Pure.
 * Unload only a substrate WE own, that is serving, is not mid-generation, and
 * whose last inference is older than the idle window. Every guard must hold —
 * never pull VRAM out from under an active turn.
 * @param {{serving: boolean, owned: boolean, busy: boolean, lastActivityAt: number, now: number, idleMs: number}} s
 */
export const shouldUnload = ({ serving, owned, busy, lastActivityAt: last, now, idleMs }) =>
  Boolean(serving) && Boolean(owned) && !busy && idleMs > 0 && (now - last) >= idleMs;

/**
 * Start the idle monitor. Every intervalMs it asks `check()` for the live
 * {serving, owned, busy} state and, if the substrate has gone idle, calls
 * `unload()`. Returns a stop function. Never throws out of a tick — a monitor
 * that crashes the loop would silently stop guarding. Impure.
 * @param {{idleMs: number, intervalMs: number, check: () => Promise<{serving:boolean,owned:boolean,busy:boolean}>, unload: () => Promise<any>}} opts
 * @returns {() => void} stop
 */
export const startIdleMonitor = ({ idleMs, intervalMs, check, unload, resolveIdleMs = null }) => {
  // STANDBY is a LIVE switch (ruling, 2026-07-26). With `resolveIdleMs` given, the
  // window is re-read every tick, so flipping standby in the stream header
  // takes effect on the next minute instead of the next restart — and the
  // monitor must therefore keep ticking even while standby is off, or turning
  // it back ON would need a restart to be heard.
  if (!resolveIdleMs && !(idleMs > 0)) {
    log.info('idle-unload disabled (SUBSTRATE_IDLE_MINUTES=0)');
    return () => {};
  }
  log.info(resolveIdleMs
    ? 'standby monitor armed — the window is re-read every tick'
    : 'idle-unload armed', { idleMinutes: idleMs / 60000, everySeconds: intervalMs / 1000 });
  const iv = setInterval(async () => {
    try {
      // A resolver that throws must not silently pin the last window — rest
      // is the reversible act, so a broken read means "stay resident".
      const window = resolveIdleMs ? await resolveIdleMs() : idleMs;
      if (!(window > 0)) return; // standby off — nothing rests
      const state = await check();
      if (shouldUnload({ ...state, lastActivityAt, now: Date.now(), idleMs: window })) {
        log.info('substrate idle — entering standby to return hardware', { idleFor: `${Math.round((Date.now() - lastActivityAt) / 1000)}s` });
        await unload();
        // Marked only AFTER the unload lands: a failed stop must not read as
        // rest, and the next summon (markActivity) clears it again.
        standbySince = new Date().toISOString();
      }
    } catch (err) {
      log.error('idle monitor tick failed — continuing', { err: err.message });
    }
  }, intervalMs);
  iv.unref?.(); // never keep the process alive just for this
  return () => clearInterval(iv);
};
