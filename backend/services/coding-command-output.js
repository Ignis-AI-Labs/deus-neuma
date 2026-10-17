/** Bounded display tails; output volume never decides a command's lifetime. */
const STREAM_LIMIT_BYTES = 50 * 1024;

/** impure - per-command output accumulator, at most 100 KiB across both streams. */
export const createCommandOutput = () => {
  const streams = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  let truncated = false;
  const append = (stream, chunk) => {
    if (stream !== 'stdout' && stream !== 'stderr') throw new Error('Unknown command output stream');
    const combined = Buffer.concat([streams[stream], chunk]);
    if (combined.length > STREAM_LIMIT_BYTES) truncated = true;
    streams[stream] = Buffer.from(combined.subarray(-STREAM_LIMIT_BYTES));
  };
  const snapshot = () => ({
    stdout: streams.stdout.toString('utf8'),
    stderr: streams.stderr.toString('utf8'),
    truncated,
  });
  return Object.freeze({ append, snapshot });
};
