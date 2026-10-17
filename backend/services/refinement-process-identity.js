import fs from 'node:fs/promises';

const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TICKS = /^[0-9]+$/;
const refuse = (message) => Object.assign(new Error(message), {
  code: 'REFINEMENT_TRANSACTION_IDENTITY',
});

/** Read Linux boot and process-start identity; null means the process provably does not exist. */
export const readRefinementProcessIdentity = async (pid = process.pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) throw refuse('process identity pid is invalid');
  try {
    const [bootIdText, stat, processState] = await Promise.all([
      fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      fs.readFile(`/proc/${pid}/stat`, 'utf8'),
      fs.stat(`/proc/${pid}`, { bigint: true }),
    ]);
    const close = stat.lastIndexOf(') ');
    const fields = close < 0 ? [] : stat.slice(close + 2).trim().split(/\s+/u);
    const bootId = bootIdText.trim();
    if (!BOOT_ID.test(bootId) || !TICKS.test(fields[19] || '')
      || !processState.isDirectory() || processState.uid < 0n
      || processState.uid > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw refuse('process identity has an invalid kernel shape');
    }
    return Object.freeze({
      pid, uid: Number(processState.uid), bootId, startTicks: fields[19],
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'REFINEMENT_TRANSACTION_IDENTITY') throw error;
    throw refuse('process identity is unreadable');
  }
};

export const sameRefinementProcessIdentity = (left, right) => Boolean(
  left && right && left.pid === right.pid && left.uid === right.uid
  && left.bootId === right.bootId && left.startTicks === right.startTicks,
);
