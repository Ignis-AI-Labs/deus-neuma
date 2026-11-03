/** The operator's independent OS-isolation preference. */
import { DESK_REFUSAL, GUEST_REFUSAL, isLocalDesk, passesInstallOwner } from './install-owner.js';

export const directShellFor = (connection, source) => (
  connection?.sandboxEnabled === false && source
    ? { sourceRoot: source.sourceRoot, direct: true }
    : null
);

export const declareSandboxMode = async (connection, enabled) => {
  if (enabled === false) {
    const req = connection.httpRequest;
    const local = req ? isLocalDesk(req) : false;
    const allowed = local ? await passesInstallOwner(req).catch(() => false) : false;
    if (!allowed) {
      connection.sandboxEnabled = true;
      return { enabled: true, error: local ? GUEST_REFUSAL : DESK_REFUSAL };
    }
  }
  connection.sandboxEnabled = enabled === true;
  return { enabled: connection.sandboxEnabled };
};
