// Load the checked extension entry after adapting its stock stdio MCP transport to parentPort.
const { pathToFileURL } = require('node:url');
const { installUtilityStdioCompat } = require('./utility-process-compat.cjs');

installUtilityStdioCompat();
const entry = process.argv[2];
if (!entry) throw new Error('extension utility entry requires the checked module path');
import(pathToFileURL(entry).href).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
