// Utility children speak parentPort; the backend's existing private lane speaks Node child IPC.
const { Readable, Writable } = require('node:stream');

const installUtilityProcessCompat = () => {
  const port = process.parentPort;
  if (!port) throw new Error('utility process compatibility requires process.parentPort');
  process.send = (message, callback) => {
    try {
      port.postMessage(message);
      if (typeof callback === 'function') queueMicrotask(() => callback(null));
    } catch (error) {
      if (typeof callback !== 'function') throw error;
      queueMicrotask(() => callback(error));
    }
  };
  port.on('message', (event) => process.emit('message', event.data));
};

// MCP servers already speak newline-delimited JSON on process.stdin/stdout. Utility children only
// accept parentPort input, so map that transport without replacing the server or its SDK.
const installUtilityStdioCompat = () => {
  const port = process.parentPort;
  if (!port) throw new Error('utility stdio compatibility requires process.parentPort');
  const input = new Readable({ read() {} });
  port.on('message', (event) => input.push(`${JSON.stringify(event.data)}\n`));
  let output = '';
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      try {
        output += chunk.toString();
        for (;;) {
          const end = output.indexOf('\n');
          if (end === -1) break;
          const line = output.slice(0, end).replace(/\r$/, '');
          output = output.slice(end + 1);
          if (line) port.postMessage(JSON.parse(line));
        }
        done();
      } catch (error) { done(error); }
    },
  });
  Object.defineProperty(process, 'stdin', { configurable: true, value: input });
  Object.defineProperty(process, 'stdout', { configurable: true, value: stdout });
};

module.exports = { installUtilityProcessCompat, installUtilityStdioCompat };
