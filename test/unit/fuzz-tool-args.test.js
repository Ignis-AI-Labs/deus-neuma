/**
 * THE TOOL-ARG CHECK, FUZZED (security seat pen + fuzz plan, item 4).
 * checkToolArgs (rogue-detector.js) is the second wall a tool call meets at
 * both seats (portal-tool-loop.js, witness-tools.js): a call whose path names
 * a secret, a key, the vault, an ssh dir, a lane's ownership record or its
 * wallet/tool policy is refused before it runs. This suite mutates those
 * paths and checks the refusal survives:
 *
 *   - case flips — the same file on a case-insensitive volume;
 *   - `./`, `//` and `name/..` respellings — the same file everywhere;
 *   - %2e / %65 encodings — never decoded by any fs tool, so never the same
 *     file (proven on a real disk below rather than assumed);
 *   - symlink-shaped names — a link is invisible to a text check by nature;
 *     the sandbox's real-path judgement (tool-sandbox.js) is the wall there,
 *     and both halves are shown.
 *
 * What it found (G-TA1..3) was fixed the same day; each finding keeps its
 * own case, so a regression names the gap it reopens. Seeded; real function.
 */
import fs from 'fs/promises';
import path from 'path';
import { checkToolArgs } from '../../backend/services/rogue-detector.js';
import { checkPathAccess, realpathOfNearestExisting } from '../../backend/services/sandbox-path-policy.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { prng, pick, flipCase, respellPath } from '../helpers/seeded-fuzz.js';

const SEED = 0xa265;
const PER_TARGET = 150;
const LANE = '/w/houses/lane';
// The seats' tool identities: the fs organ, the legacy filesystem server.
const SEATS = Object.freeze([['fs', 'read'], ['fs', 'write'], ['filesystem', 'read_text_file'], ['filesystem', 'write_file']]);

// Secrets a FILENAME names: the token survives any respelling of the folders above it.
const NAMED_SECRETS = Object.freeze([
  '.env', '.env.production', 'deploy/.env', 'credentials.json', 'secrets.json', 'owner.json', 'id_rsa',
  '.ssh/id_ed25519', '.ssh/config', 'certs/server.pem', 'certs/tls.key', 'vault/dna.enc',
]);
// Secrets a FOLDER names (keys/, config/spend-*, config/tool-policy…): the token spans a slash.
const FOLDER_SECRETS = Object.freeze([
  'keys/keypair.json', 'config/spend-policy.json', 'config/spend-allowlist.json', 'config/tool-policy.json',
  'config/sovereignty-terms.json',
]);

const flagged = (server, tool, p) => checkToolArgs(server, tool, { path: p, content: 'x' }).safe === false;

// a respelling that keeps the file, on this disk or a case-folding one (no
// trailing slash: `server.pem/` names nothing a disk opens)
const sameFileMutation = (r, target) => {
  const respelled = respellPath(r, target).replace(/\/+$/, '');
  return r() < 0.5 ? flipCase(r, respelled) : respelled;
};

describe('a sensitive path keeps its flag under mutation (seeded fuzz)', () => {
  test.each(NAMED_SECRETS)('%s — case flips and respellings keep the flag at every seat', (rel) => {
    const r = prng(SEED ^ rel.length * 31);
    const target = path.join(LANE, rel);
    for (const [server, tool] of SEATS) expect(flagged(server, tool, target), `${server}/${tool} ${target}`).toBe(true);
    for (let i = 0; i < PER_TARGET; i += 1) {
      const spelling = sameFileMutation(r, target);
      const [server, tool] = pick(r, SEATS);
      expect(flagged(server, tool, spelling), `${server}/${tool} ${JSON.stringify(spelling)}`).toBe(true);
    }
  });

  test.each(FOLDER_SECRETS)('%s — the plain path and its case flips keep the flag at every seat', (rel) => {
    const r = prng(SEED ^ rel.length * 131);
    const target = path.join(LANE, rel);
    for (let i = 0; i < PER_TARGET; i += 1) {
      const spelling = flipCase(r, target);
      const [server, tool] = pick(r, SEATS);
      expect(flagged(server, tool, spelling), `${server}/${tool} ${JSON.stringify(spelling)}`).toBe(true);
    }
  });

  // FINDING G-TA1 (security seat, builder G, 2026-10-19; fixed): checkToolArgs matched
  // `keys/keypair`, `config/spend-`, `config/tool-policy` and
  // `config/sovereignty-` as raw text and never normalized the path, so
  // `keys//keypair.json`, `keys/./keypair.json`, `keys/x/../keypair.json` and
  // `config/./tool-policy.json` — the same files — passed it as safe. The tool
  // sandbox's own checkPathAccess normalizes and still refuses them (proven in
  // fuzz-path-read-wall), so this is a hole in the second wall, not an escape.
  test('G-TA1 — a folder-named secret, respelled to the same file, keeps the flag', () => {
    const r = prng(SEED ^ 0x7a1);
    const dropped = [];
    for (const rel of FOLDER_SECRETS) {
      for (let i = 0; i < PER_TARGET; i += 1) {
        const spelling = respellPath(r, path.join(LANE, rel));
        if (!flagged('fs', 'read', spelling)) dropped.push(spelling);
      }
    }
    expect(dropped).toEqual([]);
  });

  // FINDING G-TA2 (fixed): the bare folders themselves — `keys`, `keys/`, `vault`,
  // `.ssh` — passed checkToolArgs; listing one names every key file inside. The
  // sandbox's segment match refuses each (matchesDeniedPattern).
  test('G-TA2 — naming a secret folder itself keeps the flag', () => {
    const passed = ['keys', 'keys/', 'vault', '.ssh'].map((dir) => path.join(LANE, dir))
      .filter((p) => !flagged('fs', 'read', p));
    expect(passed).toEqual([]);
  });

  // FINDING G-TA3 (fixed): outside the two filesystem servers checkToolArgs fell
  // back to a whole-args text scan that knew .env/credentials/secrets and the
  // vault/keys/.ssh folders, but not key material by name — another MCP
  // server's {path: '/x/id_rsa'} or '/x/server.pem' passed as safe.
  test('G-TA3 — key material by name keeps the flag on any server', () => {
    const passed = ['id_rsa', 'server.pem', 'tls.key', 'wallet.keystore'].map((name) => path.join(LANE, name))
      .filter((p) => !flagged('other-mcp', 'open', p));
    expect(passed).toEqual([]);
  });

  test('a backslash or %-encoded spelling is never the secret on this disk — the fs decodes neither', async () => {
    const lane = path.join(await createTempDir('tool-args-fuzz'), 'lane');
    await fs.mkdir(path.join(lane, 'keys'), { recursive: true });
    await fs.writeFile(path.join(lane, '.env'), 'planted\n');
    await fs.writeFile(path.join(lane, 'keys', 'keypair.json'), '{}\n');
    const secrets = [await fs.realpath(path.join(lane, '.env')), await fs.realpath(path.join(lane, 'keys', 'keypair.json'))];
    for (const spelling of ['%2eenv', '.%65nv', '%2E%65NV', 'keys%2fkeypair.json', 'keys\\keypair.json', 'keys%5ckeypair.json']) {
      const real = await fs.realpath(path.join(lane, spelling)).catch(() => null);
      expect(secrets.includes(real), spelling).toBe(false);
    }
  });

  test('a symlink-shaped name is invisible to the text check; the sandbox\'s real-path judgement refuses it', async () => {
    const lane = path.join(await createTempDir('tool-args-links'), 'lane');
    await fs.mkdir(path.join(lane, 'keys'), { recursive: true });
    await fs.writeFile(path.join(lane, '.env'), 'planted\n');
    await fs.writeFile(path.join(lane, 'keys', 'keypair.json'), '{}\n');
    await fs.symlink(path.join(lane, '.env'), path.join(lane, 'readme.txt'));
    await fs.symlink(path.join(lane, 'keys'), path.join(lane, 'photos'));
    // keypair.json is a secret by its name anywhere now (recheck 2026-10-20);
    // a child named innocently below the link is what only the real path sees.
    for (const link of ['readme.txt', 'photos/album.json']) {
      const p = path.join(lane, link);
      expect(flagged('fs', 'read', p), `${link}: a text check cannot see a link`).toBe(false);
      expect(checkPathAccess(await realpathOfNearestExisting(p), []).allowed, link).toBe(false);
    }
  });
});
