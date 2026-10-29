/**
 * Sandbox lane boundary — REAL MCP filesystem server, REAL disk, NO mock
 * (AGENTS.md RULE 0).
 *
 * This is the gnosis for the principle […]: a neuma
 * can read and write inside its OWN workspace, and is hard-walled out of every
 * other neuma's private data — DNA above all. Nothing here mocks the execution
 * boundary; the proof that a denied call did not run is that the file on disk is
 * unchanged, and the proof that an allowed write ran is that the bytes are there.
 *
 * The real @modelcontextprotocol/server-filesystem process is rooted at the
 * whole house so it CAN physically reach every lane — createSandboxedCallTool is
 * the only thing that confines a neuma to its own room. That is exactly the
 * layer we are proving.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import { checkToolArgs } from '../../backend/services/rogue-detector.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const SERVER = 'lane-boundary-fs';
const A_DNA = JSON.stringify({ neumaId: 'neuma-a', name: 'A' });

describe('sandbox lane boundary — own lane only, others private (gnosis, no mock)', () => {
  let house, neumaA, neumaB, bDnaPath, aDnaPath, origRoot;

  beforeAll(async () => {
    house = await createTempDir('sandbox-lane');
    origRoot = getWorkspacesRoot();      // restore in afterAll so no other test inherits `house`
    setWorkspacesRoot(house);
    await workspace.create('neuma-a'); // two real lanes, full dir structure incl. dna/
    await workspace.create('neuma-b');
    neumaA = path.resolve(house, 'neuma-a');
    neumaB = path.resolve(house, 'neuma-b');
    aDnaPath = path.join(neumaA, 'dna', 'active.json');
    // Seed neuma-a's DNA so the read-back test stands on its own, independent of
    // the write test's ordering.
    await fs.writeFile(aDnaPath, A_DNA);
    // neuma-b's private DNA — the one thing neuma-a must never reach or alter.
    bDnaPath = path.join(neumaB, 'dna', 'active.json');
    await fs.writeFile(bDnaPath, JSON.stringify({ neumaId: 'neuma-b', secret: 'b-private' }));
    // Real MCP server rooted at the house — the sandbox, not the server, is what
    // restricts each neuma to its own lane.
    await mcpService.connectToServer(SERVER, 'npx', ['-y', '@modelcontextprotocol/server-filesystem', house], {});
  }, 60000); // npx may download the package on first run

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);          // undo the module-level root mutation
    await mcpService.disconnect(SERVER);
  });

  // A fresh sandboxed caller for a neuma — fresh connection so the write budget
  // (10/session) never bleeds between tests.
  const callFor = (neumaId) => {
    const connection = { companion: neumaId ? { neumaId } : undefined, _writeOps: 0 };
    return createSandboxedCallTool(mcpService, connection, workspace);
  };

  test('a neuma writes its DNA into its OWN lane — and it lands on disk', async () => {
    const fresh = path.join(neumaA, 'dna', 'written.json');
    await callFor('neuma-a')(SERVER, 'write_file', {
      path: fresh,
      content: JSON.stringify({ neumaId: 'neuma-a', name: 'A' }),
    });
    const onDisk = JSON.parse(await fs.readFile(fresh, 'utf8')); // real bytes, real disk
    expect(onDisk.neumaId).toBe('neuma-a');
  });

  test('a neuma reads back from its OWN lane (seeded in beforeAll — self-sufficient)', async () => {
    const res = await callFor('neuma-a')(SERVER, 'read_file', { path: aDnaPath });
    const text = res.content?.find(c => c.type === 'text')?.text ?? '';
    expect(text).toContain('neuma-a');
  });

  test('a neuma CANNOT write into another neuma\'s lane — denied, and nothing changes on disk', async () => {
    const before = await fs.readFile(bDnaPath, 'utf8');
    await expect(
      callFor('neuma-a')(SERVER, 'write_file', { path: bDnaPath, content: '{"hacked":true}' }),
    ).rejects.toThrow();
    expect(await fs.readFile(bDnaPath, 'utf8')).toBe(before); // privacy held on disk, not just in a counter
  });

  test('a neuma CANNOT read another neuma\'s DNA', async () => {
    await expect(
      callFor('neuma-a')(SERVER, 'read_file', { path: bDnaPath }),
    ).rejects.toThrow();
  });

  test('move_file cannot smuggle another neuma\'s DNA into the lane (source AND dest checked)', async () => {
    const stolen = path.join(neumaA, 'stolen.json');
    const before = await fs.readFile(bDnaPath, 'utf8');
    await expect(
      callFor('neuma-a')(SERVER, 'move_file', { source: bDnaPath, destination: stolen }),
    ).rejects.toThrow();
    expect(existsSync(stolen)).toBe(false);                 // nothing exfiltrated
    expect(await fs.readFile(bDnaPath, 'utf8')).toBe(before); // source byte-identical, not just present
  });

  test('delete_file executes LOCALLY inside the lane — real unlink, honest result (2026-07-23)', async () => {
    // The approval card stands UPSTREAM (policy: approval_required); the
    // sandbox's own law is confinement + files-only. A lane file deletes for
    // real — no more faked deletions by overwrite.
    const doomed = path.join(neumaA, 'notes-to-remove.md');
    await fs.writeFile(doomed, 'x');
    const result = await callFor('neuma-a')(SERVER, 'delete_file', { path: doomed });
    expect(existsSync(doomed)).toBe(false);
    expect(result.content[0].text).toContain('Deleted');
  });

  test('delete_file refuses directories and absent paths honestly, and never crosses lanes', async () => {
    const a = callFor('neuma-a');
    // A directory is never deletable — no recursive wipes through this hand.
    await expect(a(SERVER, 'delete_file', { path: path.join(neumaA, 'dna') })).rejects.toThrow(/directories are not deletable/);
    expect(existsSync(aDnaPath)).toBe(true);
    // The lane ROOT meets an earlier wall since a437e530f: it is an ancestor of
    // the platform's coding/sandboxes control state, so the sandbox refuses it
    // before the delete hand ever runs.
    await expect(a(SERVER, 'delete_file', { path: neumaA })).rejects.toThrow(/Coding shell control state is platform-managed/);
    expect(existsSync(neumaA)).toBe(true);
    // Nothing at the path — an honest nothing, not a silent success.
    await expect(a(SERVER, 'delete_file', { path: path.join(neumaA, 'never-was.md') })).rejects.toThrow(/Nothing stands/);
    // Another lane's file is out of write confinement — refused, untouched.
    await expect(a(SERVER, 'delete_file', { path: bDnaPath })).rejects.toThrow();
    expect(existsSync(bDnaPath)).toBe(true);
  });

  test('the shared DNA directories are denied by pattern, no matter the lane', async () => {
    // data/dna, data/dna-cache, data/memory-store hold cross-neuma state — denied
    // for reads and writes regardless of which neuma asks.
    const a = callFor('neuma-a');
    await expect(a(SERVER, 'read_file', { path: path.join(house, 'data', 'dna', 'x.dna') })).rejects.toThrow();
    await expect(a(SERVER, 'write_file', { path: path.join(house, 'data', 'dna-cache', 'x.md'), content: 'x' })).rejects.toThrow();
  });

  test('a write under an unrecognized path key fails closed — confinement is never name-guessed', async () => {
    await expect(
      callFor('neuma-a')(SERVER, 'write_file', { target: path.join(neumaA, 'x.txt'), content: 'y' }),
    ).rejects.toThrow(/recognized path/);
  });

  // -------------------------------------------------------------------------
  // THE FOCUS GROUND (ruling, 2026-07-26) — the folder standing open in the
  // operator's Explorer is shared reach. Same law, proved on real disk: the
  // bytes land, or the file is untouched.
  // -------------------------------------------------------------------------
  describe('the focus ground is reach', () => {
    let ground;

    // A caller whose connection carries a focus ground, exactly as
    // portal-routes sets it from the desk's validated focus path.
    const callWithGround = (neumaId, toolWorkspace) => createSandboxedCallTool(
      mcpService,
      { companion: neumaId ? { neumaId } : undefined, _writeOps: 0, toolWorkspace },
      workspace,
    );

    beforeAll(async () => {
      // A folder that is NOT any neuma's lane — the operator's own repository.
      ground = path.join(house, 'operator-repo');
      await fs.mkdir(path.join(ground, 'src'), { recursive: true });
      await fs.mkdir(path.join(ground, 'config'), { recursive: true });
      await fs.writeFile(path.join(ground, 'src', 'app.js'), 'export const x = 1;\n');
      await fs.writeFile(path.join(ground, 'config', 'app.json'), '{"real":"source"}');
    });

    test('a neuma WRITES into the focused folder — bytes land on the operator\'s disk', async () => {
      const target = path.join(ground, 'src', 'from-neuma.js');
      await callWithGround('neuma-a', ground)(SERVER, 'write_file', {
        path: target, content: '// written in the shared ground\n',
      });
      expect(await fs.readFile(target, 'utf8')).toContain('shared ground');
    });

    test('a neuma READS the focused folder without any grant', async () => {
      const res = await callWithGround('neuma-a', ground)(SERVER, 'read_file', {
        path: path.join(ground, 'src', 'app.js'),
      });
      expect(res.content?.find(c => c.type === 'text')?.text ?? '').toContain('export const x = 1');
    });

    test("a focused repository's own config/ is ordinary source, not the platform's", async () => {
      // The regression the split fixes: 'config/' used to match as a substring
      // anywhere, so focusing any normal repo left its config/ unreachable.
      const res = await callWithGround('neuma-a', ground)(SERVER, 'read_file', {
        path: path.join(ground, 'config', 'app.json'),
      });
      expect(res.content?.find(c => c.type === 'text')?.text ?? '').toContain('real');
    });

    test('the SAME folder is refused when the desk is not focused on it', async () => {
      // Proof the ground is doing the work — not some other widening.
      await expect(
        callFor('neuma-a')(SERVER, 'read_file', { path: path.join(ground, 'src', 'app.js') }),
      ).rejects.toThrow();
    });

    test('focus does not open another neuma\'s DNA — reach is not a key ring', async () => {
      const before = await fs.readFile(bDnaPath, 'utf8');
      const call = callWithGround('neuma-a', ground);
      await expect(call(SERVER, 'read_file', { path: bDnaPath })).rejects.toThrow();
      await expect(call(SERVER, 'write_file', { path: bDnaPath, content: '{"hacked":true}' })).rejects.toThrow();
      expect(await fs.readFile(bDnaPath, 'utf8')).toBe(before);
    });

    test('focus does not open secret-shaped files INSIDE the ground', async () => {
      // .env sits in the focused repo — still hard-denied, and never grantable.
      const secret = path.join(ground, '.env');
      await fs.writeFile(secret, 'API_KEY=live-secret');
      await expect(
        callWithGround('neuma-a', ground)(SERVER, 'read_file', { path: secret }),
      ).rejects.toThrow(/Access denied/);
      expect(await fs.readFile(secret, 'utf8')).toBe('API_KEY=live-secret');
    });

    test('a sibling directory cannot ride the ground\'s name', async () => {
      const sibling = path.join(house, 'operator-repo-other');
      await fs.mkdir(sibling, { recursive: true });
      await fs.writeFile(path.join(sibling, 'x.js'), 'secret');
      await expect(
        callWithGround('neuma-a', ground)(SERVER, 'read_file', { path: path.join(sibling, 'x.js') }),
      ).rejects.toThrow();
    });

    test('the 10-write session cap does not throttle work in the ground', async () => {
      // Consent to the arena is the governor there, not a counter. A session
      // doing real work writes far more than ten times.
      const call = callWithGround('neuma-a', ground);
      for (let i = 0; i < 14; i += 1) {
        await call(SERVER, 'write_file', {
          path: path.join(ground, 'src', `bulk-${i}.js`),
          content: `// ${i}\n`,
        });
      }
      expect(existsSync(path.join(ground, 'src', 'bulk-13.js'))).toBe(true);
    });

    test('the cap still guards the being\'s OWN lane', async () => {
      // The bypass is for the consented arena only — never a blanket lift.
      const call = callWithGround('neuma-a', ground);
      await expect((async () => {
        for (let i = 0; i < 12; i += 1) {
          await call(SERVER, 'write_file', {
            path: path.join(neumaA, `lane-${i}.md`), content: `${i}`,
          });
        }
      })()).rejects.toThrow(/limit reached/);
    });
  });

  // -------------------------------------------------------------------------
  // WHICH DESTRUCTIVE ACTS ASK THE OPERATOR — #234 + #250, the two halves.
  //
  // Before: delete_file was refused unconditionally by rogue-detector AFTER the
  // approval card had already been answered ([…], with no approval that could satisfy it), while move_file
  // — implemented as fs.rename, which silently replaces its destination — ran
  // free. The tool that destroys LESS asked; the tool that destroys MORE did
  // not. Proven here against the real filesystem server: the bytes on disk are
  // the verdict.
  // -------------------------------------------------------------------------
  describe('the destructive gate, on real disk', () => {
    test('#234 — a delete is no longer refused on its NAME, and really removes the file', async () => {
      // The exact sequence both seats run: the approval card resolves, then
      // checkToolArgs, then the sandbox. Before the fix the middle step refused
      // every time, so the last step never ran.
      const doomed = path.join(neumaA, 'doomed.md');
      await fs.writeFile(doomed, 'delete me\n');
      expect(existsSync(doomed)).toBe(true);

      expect(checkToolArgs(SERVER, 'delete_file', { path: doomed }).safe).toBe(true);
      await callFor('neuma-a')(SERVER, 'delete_file', { path: doomed });

      // The proof a being no longer has to FAKE a deletion by overwriting.
      expect(existsSync(doomed)).toBe(false);
    });

    test('#234 — removing the name-block did NOT open another lane to deletion', async () => {
      // The layer that guards this is the SANDBOX, not the rogue detector:
      // checkToolArgs screens dangerous argument SHAPES (vault/, keys/keypair,
      // .ssh/), while lane confinement is checkPathAccess's job. Both are
      // asserted here in that order, because the honest question after deleting
      // a block is […].
      expect(checkToolArgs(SERVER, 'delete_file', { path: 'vault/dna/active.json' }).safe).toBe(false);

      const before = await fs.readFile(bDnaPath, 'utf8');
      await expect(
        callFor('neuma-a')(SERVER, 'delete_file', { path: bDnaPath }),
      ).rejects.toThrow();
      expect(await fs.readFile(bDnaPath, 'utf8')).toBe(before);
    });

    test('#250 — a move ONTO an existing file is refused, and that file survives byte-for-byte', async () => {
      const victim = path.join(neumaA, 'precious.md');
      const source = path.join(neumaA, 'incoming.md');
      await fs.writeFile(victim, 'a year of work\n');
      await fs.writeFile(source, 'junk\n');

      await expect(
        callFor('neuma-a')(SERVER, 'move_file', { source, destination: victim }),
      ).rejects.toThrow(/already there/i);

      // THE ASSERTION: fs.rename would have replaced this silently.
      expect(await fs.readFile(victim, 'utf8')).toBe('a year of work\n');
      expect(existsSync(source)).toBe(true); // and the move did not half-happen
    });

    test('#250 — a move to a FRESH path still runs free: the gate is on destruction, not on moving', async () => {
      // Gating every move would put a card in front of a being tidying its own
      // lane, which is the workspace sovereignty the policy layer protects.
      const source = path.join(neumaA, 'tidy-me.md');
      const fresh = path.join(neumaA, 'tidied.md');
      await fs.writeFile(source, 'organise me\n');

      await callFor('neuma-a')(SERVER, 'move_file', { source, destination: fresh });

      expect(existsSync(source)).toBe(false);
      expect(await fs.readFile(fresh, 'utf8')).toBe('organise me\n');
    });

    test('#250 — the guard does not open a back door into another lane', async () => {
      // A move is still a write, so lane confinement fires first and the
      // occupancy check never becomes a way to probe outside the lane.
      const before = await fs.readFile(bDnaPath, 'utf8');
      await expect(
        callFor('neuma-a')(SERVER, 'move_file', {
          source: path.join(neumaA, 'anything.md'), destination: bDnaPath,
        }),
      ).rejects.toThrow();
      expect(await fs.readFile(bDnaPath, 'utf8')).toBe(before);
    });
  });
});
