/**
 * The write walls on a CASE-INSENSITIVE, NORMALIZATION-INSENSITIVE volume —
 * the driver half of test/integration/sandbox-unicode-wall.test.js (#587).
 *
 * Runs inside a user + mount namespace whose volume is a casefold tmpfs (the
 * same lookup law as macOS APFS/HFS+ and ext4 casefold), so a name the walls
 * never matched opens the walled file itself. Real organ, real sandbox, real
 * kernel lookups; the parent passes every root through the environment and
 * reads one JSON line per case from stdout. impure.
 *
 * argv[2] — the volume's ASCII root, which the being holds a write grant over.
 * The walled places stand below `${volume}/ré` (NFC), so the NFD spelling of
 * that one segment is inside the grant yet a different string.
 */
import fs from 'fs/promises';
import path from 'path';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const volume = process.argv[2];
const NFC = 'r\u00e9'; // é composed (NFC)
const NFD = 're\u0301'; // e + combining acute (NFD)
const BEING = 'casefoldbeing';
const WALLET = '0x00000000000000000000000000000000000000cc';
const ORIGINAL = 'ORIGINAL';
const top = path.join(volume, NFC);
const house = process.env.WORKSPACES_ROOT;

// The walled files, by their true (NFC, lower-case) names, and the spelling a being asks for.
const s = '\u017f'; // LATIN SMALL LETTER LONG S — case-folds to "s"
const CASES = Object.freeze([
  ['nfd-mandate', path.join(process.env.NEUMA_REALM_ROOT, WALLET, 'house-mandate.json'), (p) => p.replace(NFC, NFD)],
  ['nfd-kin-policy', path.join(house, 'kinlane', 'config', 'tool-policy.json'), (p) => p.replace(NFC, NFD)],
  ['nfd-settings', path.join(process.env.NEUMA_DATA_ROOT, 'settings', 'provider-choice.json'), (p) => p.replace(NFC, NFD)],
  ['fold-mandate', path.join(process.env.NEUMA_REALM_ROOT, WALLET, 'house-mandate.json'), (p) => p.replace('house-mandate.json', `HOU${s}E-MANDATE.JSON`)],
  ['fold-voice-seal', path.join(house, BEING, 'voice', 'seal.json'), (p) => p.replace('seal.json', `${s}eal.json`)],
  ['fold-lane-marker', path.join(house, 'kinlane', 'lane.json'), (p) => p.replace('lane.json', `lane.j${s}on`)],
  ['fold-settings', path.join(process.env.NEUMA_DATA_ROOT, 'settings', 'provider-choice.json'), (p) => p.replace(`${path.sep}settings${path.sep}`, `${path.sep}${s}ettings${path.sep}`)],
  ['fold-ssh', path.join(process.env.HOME, '.ssh', 'authorized_keys'), (p) => p.replace('.ssh', `.${s}${s}h`)],
  ['case-kin-policy', path.join(house, 'kinlane', 'config', 'tool-policy.json'), (p) => p.replace('config', 'CoNfIg')],
]);

const run = async () => {
  await fs.mkdir(top, { recursive: true });
  await workspace.create(BEING);
  for (const [, file] of CASES) await fs.mkdir(path.dirname(file), { recursive: true });
  await setNativeFilesystemRoots([volume]);
  mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  const results = [];
  for (const [name, file, spell] of CASES) {
    const asked = spell(file);
    await fs.writeFile(file, ORIGINAL);
    const call = withFsRouting(createSandboxedCallTool(mcpService, {
      companion: { neumaId: BEING }, _writeOps: 0, _grantedWriteRoots: [volume],
    }, workspace));
    let refused = null;
    try {
      const result = await call('fs', 'write', { path: asked, content: 'FORGED' });
      if (result?.isError) refused = `organ: ${result?.content?.[0]?.text || 'error'}`;
    } catch (err) {
      refused = err.message;
    }
    results.push({ name, asked, sameString: asked === file, refused, bytes: await fs.readFile(file, 'utf8') });
  }
  await mcpService.disconnect('filesystem');
  process.stdout.write(`${JSON.stringify(results)}\n`);
};

run().catch((err) => {
  process.stdout.write(`${JSON.stringify({ error: err.stack || err.message })}\n`);
  process.exitCode = 1;
});
