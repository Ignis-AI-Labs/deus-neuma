// The installer's headless model setup: the real CLI as a utility child, never RunAsNode.
const { app, utilityProcess } = require('electron');
const path = require('node:path');

const run = () => {
  app.whenReady().then(() => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = utilityProcess.fork(path.join(__dirname, '..', 'backend', 'cli', 'setup-model-server.mjs'), process.argv.slice(2), {
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.once('exit', (code) => app.exit(code ?? 1));
    child.on('error', (error) => {
      console.error(`Model server setup could not start: ${error.message}`);
      app.exit(1);
    });
  }).catch((error) => {
    console.error(`Model server setup could not start: ${error.message}`);
    app.exit(1);
  });
};

module.exports = { run };
