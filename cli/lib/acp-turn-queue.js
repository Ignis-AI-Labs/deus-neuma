// ACP requests stay concurrent so cancel reaches a running turn. Prompt turns
// themselves are serialized because process.cwd is global to every session.

/** Run prompt functions one at a time; a rejection does not poison the queue. */
export const createAcpTurnQueue = () => {
  let tail = Promise.resolve();
  return (turn) => {
    const running = tail.then(turn);
    tail = running.catch(() => {});
    return running;
  };
};
