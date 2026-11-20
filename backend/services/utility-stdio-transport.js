// MCP JSON-RPC messages over an Electron utility child's parentPort.

// impure (child process IO) — the SDK Transport interface over UtilityProcess.
export class UtilityStdioTransport {
  constructor(child) {
    this.child = child;
    this.started = false;
  }

  get stderr() { return this.child.stderr ?? null; }

  async start() {
    if (this.started) throw new Error('utility stdio transport already started');
    this.started = true;
    this.child.on('message', (message) => this.onmessage?.(message));
    this.child.once('exit', () => this.onclose?.());
  }

  async send(message) {
    this.child.postMessage(message);
  }

  async close() {
    this.child.kill();
  }
}
