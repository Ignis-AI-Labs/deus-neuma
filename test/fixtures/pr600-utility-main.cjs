const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app } = require('electron');

app.disableHardwareAcceleration();
app.on('window-all-closed', (event) => event.preventDefault());
app.setPath('userData', process.env.PR600_UTILITY_PROFILE);

const { extensionById } = require('../../backend/services/extensions/extension-catalog.js');
const { extensionDir, updateInstalled } = require('../../backend/services/extensions/extension-store.js');
const { listExtensionTools, callExtensionTool, stopExtension } = require('../../backend/services/extensions/extension-runner.js');
const { startBackend, stopBackend, waitForBackend, getOrigin } = require('../../electron/backend-spawn.cjs');

const prepareExtension = async () => {
  const entry = extensionById('memory');
  const pkg = path.join(extensionDir('memory'), 'node_modules', entry.package);
  fs.mkdirSync(path.dirname(path.join(pkg, entry.bin)), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: entry.package, version: entry.version, type: 'module' }));
  const sdk = (file) => JSON.stringify(pathToFileURL(path.join(__dirname, '../../node_modules/@modelcontextprotocol/sdk/dist/esm', file)).href);
  const server = fs.readFileSync(path.join(__dirname, 'pr600-extension-server.mjs'), 'utf8')
    .replace("'@modelcontextprotocol/sdk/server/index.js'", sdk('server/index.js'))
    .replace("'@modelcontextprotocol/sdk/server/stdio.js'", sdk('server/stdio.js'))
    .replace("'@modelcontextprotocol/sdk/types.js'", sdk('types.js'));
  fs.writeFileSync(path.join(pkg, entry.bin), server);
  fs.writeFileSync(path.join(extensionDir('memory'), 'package.json'), '{"private":true}\n');
  fs.writeFileSync(path.join(extensionDir('memory'), 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
  await updateInstalled('memory', () => ({ id: 'memory', enabled: true, blocked: false, tools: null }));
};

app.whenReady().then(async () => {
  globalThis.result = {};
  try {
    await prepareExtension();
    const tools = await listExtensionTools('memory');
    const answer = await callExtensionTool('memory', 'environment', {});
    globalThis.result.extension = { tools: tools.map((tool) => tool.name), environment: JSON.parse(answer.content[0].text) };
    await stopExtension('memory');

    const { jsRuntime, runTool, toolEnvironment } = await import('../../backend/services/watch/watch-tools.js');
    globalThis.result.watch = {
      runtime: jsRuntime(),
      inheritsRunAsNode: Boolean(toolEnvironment().ELECTRON_RUN_AS_NODE),
      check: await runTool(jsRuntime(), ['--version']),
    };

    await startBackend({ onRestarted: () => {} });
    await waitForBackend();
    const origin = getOrigin();
    const health = await fetch(`${origin}/api/v1/health`);
    globalThis.result.backend = { origin, status: health.status, body: await health.text() };
    await stopBackend();
  } catch (error) {
    globalThis.result.fatal = error.stack || error.message;
  } finally {
    globalThis.result.ready = true;
  }
});
