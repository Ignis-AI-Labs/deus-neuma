// One launch gets a bounded number of expensive Recovery Kit openings.

const MAX_RECOVERY_ATTEMPTS = 5;

// impure (closure state) — the count is per openAtRestKeys call
const boundedRecovery = (tryCode) => {
  let attempts = 0;
  return (code) => {
    if (attempts >= MAX_RECOVERY_ATTEMPTS) {
      throw new Error('Too many Recovery Kit attempts. Quit Neuma and start again to try another code.');
    }
    attempts += 1;
    return tryCode(code);
  };
};

module.exports = { boundedRecovery, MAX_RECOVERY_ATTEMPTS };
