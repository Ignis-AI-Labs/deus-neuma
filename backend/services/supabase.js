/**
 * Back-compat shim.
 *
 * The platform store is now local-first (embedded SQLite by default, Supabase as
 * an optional upgrade). The real implementation lives in `platform-db.js` behind
 * the PlatformStore driver interface (`drivers/`). This file remains only so the
 * existing import sites — `server.js`, `portal-routes.js`, the injected
 * finalize-birth arg, and the `vitest.config.js` coverage include — keep working
 * and continue to receive the same singleton.
 */

export { default } from './platform-db.js';
