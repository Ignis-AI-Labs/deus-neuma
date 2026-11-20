// The wallet's two reveal doors, over the secret gate (audit PR600 P6-10):
// the recovery secret of a wallet opened with its password, and the phrase of
// a key made on this computer. Both name the wallet in the prompt, both show
// the secret in the trusted window, and neither hands it to the page.
//
// The two creation doors do the same for a wallet's FIRST showing: the wallet
// is made, its phrase is shown in the trusted window, and the asker is told
// the id and address only. No prompt stands in front of them — the phrase of
// a wallet made this instant opens nothing anyone holds yet.

const WATCHED = 'Make sure no one is watching your screen — including screen share or recording.';

/**
 * @param {{service: object, gate: {reveal: Function}}} deps - the wallet service and a secret gate (secret-gate.cjs)
 * @returns {{reveal: (id: string|null, password: string) => Promise<{shown: true}>, revealMade: (id: string|null) => Promise<{shown: true}>,
 *   create: (password: string) => Promise<{id: string, address: string, shown: true}>, createForMe: () => Promise<{id: string, address: string, shown: true}>}}
 */
const walletRevealDoors = ({ service, gate }) => {
  // impure (registry read) — the wallet a reveal is about, as the prompt names it
  const subjectOf = (id) => {
    const wallets = service.list();
    const wallet = wallets.find((w) => w.id === (id || service.status().activeId));
    return { label: 'WALLET', value: wallet?.address || 'unknown wallet' };
  };
  // impure — a wallet made a moment ago: its phrase to the trusted window, its id and address to the asker
  const shownOnce = async (made, intro) => {
    await gate.show({ heading: 'Recovery phrase', intro, secret: made.mnemonic, subject: { label: 'WALLET', value: made.address } });
    return { id: made.id, address: made.address, shown: true };
  };
  return Object.freeze({
    create: async (password) => shownOnce(service.create(password),
      'Your new wallet\'s recovery phrase. Write these words down and keep them away from this computer: they are the only way back in if you forget your password.'),
    createForMe: async () => shownOnce(service.createForMe(),
      'Your key is made and kept by this computer. Write these words down and keep them away from it: they are the only way to bring the key back on another machine.'),
    reveal: (id, password) => gate.reveal({
      read: () => service.revealSecret(id, password),
      subject: subjectOf(id),
      gate: {
        message: 'Reveal this wallet\'s recovery secret?',
        detail: `Anyone who sees these words or this private key controls the wallet and its funds. ${WATCHED}`,
        confirmLabel: 'Reveal', tone: 'alert',
      },
      heading: 'Recovery secret',
      intro: 'This restores the wallet on another machine. Write it down and keep it away from this computer.',
    }),
    revealMade: (id) => gate.reveal({
      read: () => service.revealMadeMnemonic(id),
      subject: subjectOf(id),
      gate: {
        message: 'Reveal this wallet\'s recovery phrase?',
        detail: `Anyone who sees these 24 words controls this wallet and its funds. ${WATCHED}`,
        confirmLabel: 'Reveal', tone: 'alert',
      },
      heading: 'Recovery phrase',
      intro: 'The 24 words that restore this wallet on another machine. Write them down and keep them away from this computer.',
    }),
  });
};

module.exports = { walletRevealDoors };
