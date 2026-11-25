// The operator's RootData key, when one is attached (Settings, API, Lead data). Never shown to a being. impure.
import { resolveUsableCredential } from '../oauth-token-broker.js';

/** @returns {Promise<?string>} */
export const rootdataKey = async () => (await resolveUsableCredential('rootdata').catch(() => null))?.apiKey ?? null;
