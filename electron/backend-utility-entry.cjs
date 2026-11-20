const { installUtilityProcessCompat } = require('./utility-process-compat.cjs');

installUtilityProcessCompat();
import('../backend/server.js').catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
