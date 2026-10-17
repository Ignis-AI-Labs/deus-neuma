# Test Suite

Neuma uses **Vitest** for unit and integration tests and **Hardhat** for smart contract tests.

## Quick Reference

```bash
npm test                 # Run all Vitest tests (unit + integration)
npm run test:unit        # Unit tests only (test/unit/)
npm run test:integration # Integration tests only (test/integration/)
npm run test:contracts   # Hardhat contract tests (test/contracts/)
npm run test:watch       # Vitest in watch mode
npm run test:coverage    # Coverage report (V8 provider)
```

## Directory Structure

```
test/
├── unit/                563 test files — narrow-scope tests
│   ├── auth.test.js
│   ├── dna-vault-service.test.js
│   ├── evolution-engine.test.js
│   ├── llm-provider.test.js
│   ├── neuma-memory.test.js
│   ├── prompt-assembler.test.js
│   ├── social-service.test.js
│   ├── xss-prevention.test.js
│   └── ...
├── integration/         452 test files — end-to-end and API tests
│   ├── api-auth-enforcement.test.js
│   ├── api-llm-ssrf.test.js
│   ├── birth-protocol-e2e.test.js
│   ├── blockchain-e2e.test.js
│   ├── websocket-streaming.test.js
│   └── ...
├── contracts/           Solidity contract tests (Hardhat)
│   ├── NeumaAvatarV2.test.js
│   ├── NeumaMarketplaceV2.test.js
│   ├── NeumaFoundry.test.js
│   ├── CreatorRegistry.test.js
│   └── upgrades.test.js
├── helpers/             Test utilities — REAL dependencies, never stand-ins
│   ├── temp-fs.js         createTempDir(label) — returns path string
│   ├── witness.js         a real wallet + real HMAC session that really owns a lane
│   ├── claim-owner.js     writes a real owner.json the ownership gate reads
│   ├── local-provider.js  a REAL OpenAI-compatible server on loopback
│   └── think-probe.js     answers the provider's real once-per-endpoint probe
├── setup.js             Vitest global setup
└── README.md            This file
```

## Test Patterns

### Temporary directories

Use the `createTempDir` helper for tests that need filesystem access:

```js
import { createTempDir } from '../helpers/temp-fs.js';

const tmpDir = createTempDir('my-test');  // Returns a path string
```

### Console output

Do not spy on `console` — `test/setup.js` already silences it for the whole suite.

### Singleton resets

Use `vi.resetModules()` in `beforeEach` for modules that export singletons:

```js
beforeEach(() => {
  vi.resetModules();
});
```

### Real auth for route tests (the auth mock is REPEALED — #390)

Never mock `backend/services/auth.js`. The old recipe injected `req.walletAddress`
directly, so every ownership gate below it was measured against a string the test
chose. `auth.js` is pure `ethers` plus an HMAC — no network, no chain — so the real
path costs nothing. Use `test/helpers/witness.js`:

```js
const witness = await witnessFor(workspacesRoot, neumaId); // claims owner.json AND mints a paired token
const res = await request(app).get(`/api/v1/thing/${neumaId}`).set(witness.header);
```

`witnessFor` binds one wallet to both halves — the claim on disk and the session
token — because a lane claimed by one address and a token minted for another fails
as a 403 that reads like a broken gate. For the other half of an ownership test use
`strangerWitness()`: a real wallet with a real session that owns nothing.

**The module-registry rule.** `auth.js` memoizes its token secret per module
instance. In a file that calls `vi.resetModules()` and then `await import(...)`s the
router, import the helper the same way, *after* the reset — a top-level import mints
its token from a different instance and every request 401s:

```js
beforeEach(async () => {
  vi.resetModules();
  const { witnessFor } = await import('../helpers/witness.js');
  witness = await witnessFor(workspacesRoot, neumaId);
  const { default: router } = await import('../../backend/routes/thing-routes.js');
});
```

A 401 check needs no ceremony at all: send no `Authorization` header.

### Real dependencies for the model wire and MCP (#390 tranche 6)

**A real dependency configured for testing is not a mock.** A testnet, a temp
directory, a server you actually start — all fine. What Rule 0 forbids is the
STAND-IN: replacing the thing whose behaviour you are claiming.

**The model wire.** Never mock `createStreamRequest`/`consumeStream` — that
proves a promise resolved. Start a real OpenAI-compatible server instead, and
let the real `llm-provider` connect to it over a real socket. Request
construction, headers, body, SSE framing, chunk assembly and error handling
all run:

```js
const provider = await startLocalProvider({ reply: 'A Local Answer' });
llm.setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });
// ... exercise the route ...
expect(provider.turns[0].messages[1].content).toContain('what was really sent');
await provider.close();
```

Use `closedProviderEndpoint()` for honest unreachability — a really-closed
port, not a stub returning `false`. Assert on `provider.turns` (the body the
server RECEIVED), never on a spy's argument list.

Two traps. A **neuma** may not be routed through a non-sovereign provider
(`custom` is refused at the write seam *and* at call time — see
`docs/protocols/sovereignty-boundary.md`); use the sovereign machine route, or
a witness lane if you genuinely mean a witness. And the provider makes a
one-off think-behaviour probe per endpoint+model — `local-provider.js` answers
it and keeps it out of `turns`, which is why hand-rolled stub servers drift on
body indexes.

No weights run this way, and no test should claim otherwise. Real generation
belongs in the substrate-live lane (`RUN_GPU_ENGINE_TESTS=1`), never in the
parallel suite — presence is not consent (`helpers/gpu-optin.js`).

**MCP.** Never stub `mcpService.callTool`; that is the execution boundary, and
stubbing it is what cost a being its workspace. Spawn a real child instead —
`@modelcontextprotocol/server-filesystem` is a local dependency, so no network
is involved — and prove a tool call by the bytes it leaves:

```js
await mcpService.connectToServer('lane-fs', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', tmpDir], {});
await mcpService.callTool('lane-fs', 'write_file', { path: file, content: 'real' });
expect(await fs.readFile(file, 'utf8')).toBe('real');   // the assertion a stub cannot make
```

For the platform's own filesystem organ, call `connectFilesystemServer()` the
way boot does. Roughly half a second per connection — that is the price of the
call meaning something.

### Contract tests (Hardhat)

Contract tests use `loadFixture` from Hardhat for deterministic state:

```js
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

async function deployFixture() {
  const [owner, addr1] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory('NeumaAvatarV2');
  const proxy = await upgrades.deployProxy(Factory, [owner.address], { kind: 'uups' });
  return { proxy, owner, addr1 };
}

it('mints an avatar', async () => {
  const { proxy, owner } = await loadFixture(deployFixture);
  // ...
});
```

## Coverage

Coverage is configured with V8 provider targeting:

- `core/` — consciousness engine
- `backend/routes/` — API routes
- `backend/services/` — business logic
- `backend/utils/` — shared utilities
- `backend/middleware/` — Express middleware

Thresholds: 60% statements, 50% branches, 55% functions, 60% lines.

## Configuration

Vitest configuration lives in `vitest.config.js` at the project root. Key settings:

- **Environment**: Node
- **Globals**: enabled (no need to import `describe`, `it`, `expect`)
- **Timeout**: 15 seconds per test
- **Setup**: `test/setup.js` runs before all tests
