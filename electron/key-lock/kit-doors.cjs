// The Recovery Kit's three doors, over the secret gate (audit PR600 P6-10).
// The kit code opens every key of this install, so it is shown in the trusted
// window and never handed to the page; and dropping this computer's copy of it
// (the […] door, which used to answer anyone on the desk without a
// question) now asks the person first — after it, the kit cannot be shown again.

const SUBJECT = Object.freeze({ label: 'OPENS', value: 'every key on this computer' });
const SHOWN = Object.freeze({
  subject: SUBJECT,
  heading: 'Recovery Kit',
  intro: 'Write this code down or print it, and keep it away from this computer. It is the only way back if this computer\'s keychain is ever reset.',
});

/**
 * @param {{lock: object, gate: object, file: () => string, seal: () => object, keys: () => object, onSaved: () => void, onReplaced: () => void}} deps
 *   lock is key-lock.cjs; gate a secret gate (secret-gate.cjs); keys the opened at-rest keys
 * @returns {{revealKit: () => Promise<{shown: true}>, confirmKit: () => Promise<object>, newKit: () => Promise<{shown: true}>}}
 */
const kitDoors = ({ lock, gate, file, seal, keys, onSaved, onReplaced }) => Object.freeze({
  revealKit: () => gate.reveal({
    ...SHOWN,
    read: () => lock.revealKit({ file: file(), seal: seal() }),
    gate: {
      message: 'Reveal your Recovery Kit?',
      detail: 'Anyone who sees this code can recover your keys. Make sure no one is watching or recording your screen.',
      confirmLabel: 'Reveal', tone: 'alert',
    },
  }),
  confirmKit: async () => {
    const ok = await gate.confirm({
      subject: SUBJECT,
      message: 'Have you saved your Recovery Kit?',
      detail: 'After this, this computer forgets the code and cannot show it again. Without it, a reset keychain locks you out of everything here.',
      confirmLabel: 'I saved it', tone: 'alert',
    });
    if (!ok) throw new Error('Not confirmed.');
    lock.confirmKit({ file: file() });
    onSaved();
    return {};
  },
  newKit: async () => {
    const ok = await gate.confirm({
      subject: SUBJECT,
      message: 'Replace your Recovery Kit?',
      detail: 'Every previous Recovery Kit stops working. This cannot be undone.',
      confirmLabel: 'Replace', tone: 'alert',
    });
    if (!ok) throw new Error('Replacement cancelled.');
    lock.replaceKit({ file: file(), seal: seal(), keys: keys() });
    onReplaced();
    return gate.show({ ...SHOWN, secret: lock.revealKit({ file: file(), seal: seal() }) });
  },
});

module.exports = { kitDoors };
