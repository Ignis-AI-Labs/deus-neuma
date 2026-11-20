// One line of a person's input — a key or a secret they paste — read from stdin,
// so the value never sits in an argument (a shell's history keeps arguments). impure.

/**
 * @param {NodeJS.ReadableStream} stdin
 * @returns {Promise<string>} the first line, without its newline
 */
export const readOneLine = (stdin) => new Promise((resolve) => {
  let data = '';
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk) => {
    data += chunk;
    if (data.includes('\n')) { stdin.pause(); resolve(data.split('\n')[0]); }
  });
  stdin.on('end', () => resolve(data.split('\n')[0]));
});
