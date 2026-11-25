// The one road a secret takes to the person's eyes (audit PR600 P6-10).
//
// A recovery phrase, a private key or the Recovery Kit code used to be handed
// back to the page that asked: whatever ran in that page read it. The prompt
// in front of it said nothing about which wallet, could be raised again the
// moment it was declined, and a key made on this computer needed no password
// at all. Here the secret is read first (so a wrong password or a wallet with
// nothing to show raises no window), the prompt names what it is about and
// refuses an approval for its first moments, a declined prompt cannot be
// raised again until a rest has passed, and the secret is then shown in the
// trusted window. The asker is told only that it was shown.
//
// The two windows are injected (trusted-gate.cjs gives the real ones), so
// the order and the rest are provable without Electron.

const DEFAULT_REST_MS = 20 * 1000;
const DEFAULT_ARM_MS = 2 * 1000;

/**
 * @param {{ask: (spec: object) => Promise<boolean>, show: (spec: object) => Promise<*>, now?: () => number, restMs?: number, armMs?: number}} deps
 *   ask raises the trusted prompt and resolves to the person's choice; show raises the trusted secret window
 * @returns {{confirm: (spec: object) => Promise<boolean>, reveal: (spec: object) => Promise<{shown: true}>, show: (spec: object) => Promise<{shown: true}>}}
 *   show is for a secret whose prompt was just approved (a kit made a moment ago)
 */
const createSecretGate = ({ ask, show, now = Date.now, restMs = DEFAULT_REST_MS, armMs = DEFAULT_ARM_MS }) => {
  let restUntil = 0;

  // impure — one prompt; a "no" starts the rest, during which no prompt is raised at all
  const confirm = async (spec) => {
    const wait = restUntil - now();
    if (wait > 0) throw new Error(`That was just declined. Wait ${Math.ceil(wait / 1000)} seconds before asking again.`);
    const approved = (await ask({ ...spec, armMs })) === true;
    if (!approved) restUntil = now() + restMs;
    return approved;
  };

  /**
   * impure — read, ask, then show in the trusted window. Never returns the secret.
   * @param {{read: () => string|Promise<string>, gate: object, subject: {label: string, value: string}, heading: string, intro: string}} spec
   */
  const reveal = async ({ read, gate, subject, heading, intro }) => {
    const secret = await read();
    if (typeof secret !== 'string' || !secret) throw new Error('There is nothing to show.');
    if (!(await confirm({ ...gate, subject }))) throw new Error('Reveal cancelled.');
    await show({ heading, intro, secret, subject });
    return { shown: true };
  };

  return Object.freeze({ confirm, reveal, show: async (spec) => { await show(spec); return { shown: true }; } });
};

module.exports = { createSecretGate, DEFAULT_REST_MS, DEFAULT_ARM_MS };
