// email-binding.js — which neuma holds the email position.
//
// The mailbox is an outward-facing POSITION exactly like a social channel:
// one neuma may hold it, an unbound account is usable by NO ONE even when
// credentials exist, and no other neuma can ride those keys. The store is
// the social layer's binding factory pointed at its own file and catalog —
// same governance record shape, same default-deny law.

import { join } from 'path';
import { createChannelBindings } from '../social/channel-bindings.js';
import { EMAIL_ACCOUNT, getEmailAccount } from './email-registry.js';
import { getSettingsDir } from '../data-root.js';

const DEFAULT_PATH = join(getSettingsDir(), 'email-binding.json');

// Overridable per call (not at import) so tests exercising the real disk
// path never touch the operator's live binding.
export const emailBindingPath = () =>
  process.env.NEUMA_EMAIL_BINDING_PATH || DEFAULT_PATH;

/**
 * May this neuma use the email account? (pure, fail closed — the same rule
 * canNeumaPost applies to social channels.)
 * @param {Record<string, {neumaId: string}>} bindings
 * @param {string|null|undefined} neumaId
 * @returns {boolean}
 */
export const canNeumaUseEmail = (bindings, neumaId) =>
  typeof neumaId === 'string' && neumaId.length > 0 &&
  bindings?.[EMAIL_ACCOUNT.id]?.neumaId === neumaId;

// The one instance the routes and the portal share.
export const emailBinding = createChannelBindings({
  path: emailBindingPath,
  isValidId: (id) => getEmailAccount(id) !== null,
});
