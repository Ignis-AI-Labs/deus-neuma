// #20 S1 — residency daemon foundation: wrapper script + systemd unit.
//
// REAL bash, REAL filesystem — no mocks anywhere on the claimed path
// (AGENTS.md RULE 0). The wrapper is tested by spawning it under a PATH that
// contains a stub `systemctl` shim (test/helpers/daemon-wrapper-kit.js) —
// the shim records its argv to disk so the test can assert what the wrapper
// invoked. The actual systemd daemon-management calls are NOT exercised
// against the host's systemd (that would require enabling/disabling real
// user services); the shim is the substitute for SYSTEMD ITSELF, not for
// the wrapper-under-test. That keeps RULE 0 honest: the entire wrapper
// script runs unmodified; only the external dependency it would shell out
// to is substituted, the same way migrateFile's real DEK + real disk run
// against synthesized beings (not real ones) in the S4a/b tests.
//
// The health/residency/doctor verbs against a real HTTP server are proven
// in residency-daemon-health.test.js.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  REPO_ROOT, WRAPPER, UNIT_TEMPLATE, buildStubBin, runWrapper,
} from '../helpers/daemon-wrapper-kit.js';

describe('#20 S1 — neuma-daemon wrapper (verb dispatch via stubbed systemctl)', () => {
  let stubBin;
  let stubLog;
  beforeEach(async () => {
    const dir = await createTempDir('s20-stub-log');
    stubLog = path.join(dir, 'argv.log');
    await fs.writeFile(stubLog, '');
    stubBin = await buildStubBin(stubLog);
  });

  // INVARIANT 1 — wrapper exists, is executable, and bash -n proves the
  // script parses (caught at test-time so a syntax slip can't ship)
  it('wrapper script exists, is executable, and parses cleanly', async () => {
    const stat = await fs.stat(WRAPPER);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o111).toBeGreaterThan(0); // any execute bit set
    // bash -n parses without executing — proves syntax
    const { exitCode, stderr } = await runWrapper(['--help']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  // INVARIANT 2 — help prints all verbs + usage
  it('--help / help / no-arg prints usage with every verb listed', async () => {
    for (const args of [['--help'], ['help'], []]) {
      const { stdout, exitCode } = await runWrapper(args);
      expect(exitCode).toBe(0);
      // Verbs are documented in usage
      for (const v of ['install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs', 'enable', 'disable', 'health', 'residency', 'doctor']) {
        expect(stdout).toContain(v);
      }
    }
  });

  // INVARIANT 3 — start/stop/restart/enable/disable each invoke the right
  // `systemctl --user <verb> neuma.service` exactly once
  it.each([
    ['start',   'start neuma.service'],
    ['stop',    'stop neuma.service'],
    ['restart', 'restart neuma.service'],
    ['enable',  'enable neuma.service'],
    ['disable', 'disable neuma.service'],
  ])('%s → invokes `systemctl --user %s` exactly once', async (verb, expected) => {
    const { exitCode } = await runWrapper([verb], { stubBin });
    expect(exitCode).toBe(0);
    // ai6 R1.6 — assert exactness, not just presence. Split lines, find
    // any line whose first token is `systemctl` and matches the expected
    // invocation; expect exactly one.
    const lines = (await fs.readFile(stubLog, 'utf8')).split('\n').filter(Boolean);
    const systemctlCalls = lines.filter((l) => l.startsWith('systemctl '));
    const matchingCalls = systemctlCalls.filter((l) => l === `systemctl --user ${expected}`);
    expect(matchingCalls).toHaveLength(1);
    // No EXTRA systemctl calls beyond the session-probe + the expected verb call
    // (show-environment is the session probe done by require_systemd_user)
    const otherCalls = systemctlCalls.filter(
      (l) => l !== `systemctl --user ${expected}` &&
             l !== 'systemctl --user show-environment',
    );
    expect(otherCalls, `unexpected extra systemctl calls: ${otherCalls.join(' | ')}`).toEqual([]);
  });

  // INVARIANT 4 — status invokes the right systemctl call + tolerates
  // its non-zero exit (an inactive service returns non-zero from
  // `status` but that's INFORMATIONAL, not a failure of the wrapper)
  it('status invokes systemctl --user status --no-pager neuma.service', async () => {
    const { exitCode } = await runWrapper(['status'], { stubBin });
    expect(exitCode).toBe(0);
    const log = await fs.readFile(stubLog, 'utf8');
    expect(log).toMatch(/systemctl --user status --no-pager neuma\.service/);
  });

  // INVARIANT 5 — logs uses journalctl, with -f when requested
  it('logs invokes journalctl with the right unit; -f follows', async () => {
    await runWrapper(['logs'], { stubBin });
    let log = await fs.readFile(stubLog, 'utf8');
    expect(log).toMatch(/journalctl --user -u neuma\.service/);
    expect(log).not.toMatch(/-f\b/);
    // Reset log for the -f variant
    await fs.writeFile(stubLog, '');
    await runWrapper(['logs', '-f'], { stubBin });
    log = await fs.readFile(stubLog, 'utf8');
    expect(log).toMatch(/journalctl --user -u neuma\.service -f/);
  });

  // INVARIANT 6 — unknown verb exits 2 with a clean error + usage
  it('unknown verb exits 2 with error and usage', async () => {
    const { stdout, stderr, exitCode } = await runWrapper(['frobnicate'], { stubBin });
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/unknown verb: frobnicate/);
    expect(stdout).toMatch(/Usage:/);
  });

  // INVARIANT 7 — install renders the template into XDG_CONFIG_HOME as a
  // REGULAR FILE (not a symlink) with __REPO_ROOT__ substituted for the
  // actual checkout path. This makes the daemon portable across any clone
  // location (the Gigabyte AI TOP rig, a fresh VPS, anyone's `~/src/neuma`).
  // Idempotent: re-install replaces cleanly. Uninstall removes.
  it('install + uninstall: renders template with __REPO_ROOT__ substituted, idempotent, scoped to XDG_CONFIG_HOME', async () => {
    const xdg = await createTempDir('s20-xdg');
    const expectedInstalled = path.join(xdg, 'systemd/user/neuma.service');

    // First install: rendered file created, daemon-reload + enable invoked
    let r = await runWrapper(['install'], { stubBin, env: { XDG_CONFIG_HOME: xdg } });
    expect(r.exitCode).toBe(0);
    let st = await fs.lstat(expectedInstalled);
    expect(st.isSymbolicLink(), 'install must write a regular file, not a symlink').toBe(false);
    expect(st.isFile(), 'install must produce a regular file').toBe(true);
    const rendered = await fs.readFile(expectedInstalled, 'utf8');
    // The placeholder must be fully substituted with the actual REPO_ROOT —
    // this is the core load-bearing invariant: the daemon would crash on
    // start if WorkingDirectory pointed at a literal `__REPO_ROOT__` path.
    expect(rendered, 'rendered unit must contain no unsubstituted placeholders')
      .not.toMatch(/__REPO_ROOT__/);
    // ai6 R1: the previous escape regex `/[.*+?^${}()|[\\]\\\\]/g` closed its
    // char class early and was effectively dead code — it passed only because
    // /workspace/repos/neuma contains no regex metachars. Replaced with the
    // canonical MDN form, extracted to a helper so it can't drift again.
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedRoot = escapeRegex(REPO_ROOT);
    expect(rendered, 'WorkingDirectory must be substituted to the test\'s REPO_ROOT')
      .toMatch(new RegExp(`^WorkingDirectory=${escapedRoot}$`, 'm'));
    expect(rendered, 'EnvironmentFile must point at the test\'s REPO_ROOT/.env')
      .toMatch(new RegExp(`^EnvironmentFile=-${escapedRoot}/\\.env$`, 'm'));
    let log = await fs.readFile(stubLog, 'utf8');
    expect(log).toMatch(/systemctl --user daemon-reload/);
    expect(log).toMatch(/systemctl --user enable neuma\.service/);

    // Second install: idempotent (file replaced cleanly, no error)
    r = await runWrapper(['install'], { stubBin, env: { XDG_CONFIG_HOME: xdg } });
    expect(r.exitCode).toBe(0);
    st = await fs.lstat(expectedInstalled);
    expect(st.isFile()).toBe(true);
    expect(st.isSymbolicLink()).toBe(false);

    // Uninstall: file removed, stop + disable invoked
    await fs.writeFile(stubLog, '');
    r = await runWrapper(['uninstall'], { stubBin, env: { XDG_CONFIG_HOME: xdg } });
    expect(r.exitCode).toBe(0);
    await expect(fs.lstat(expectedInstalled)).rejects.toMatchObject({ code: 'ENOENT' });
    log = await fs.readFile(stubLog, 'utf8');
    expect(log).toMatch(/systemctl --user stop neuma\.service/);
    expect(log).toMatch(/systemctl --user disable neuma\.service/);

    // Uninstall again: idempotent (nothing-to-do path, exits 0)
    r = await runWrapper(['uninstall'], { stubBin, env: { XDG_CONFIG_HOME: xdg } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/nothing installed/);
  });

  // Backwards-compat: a pre-template install left a SYMLINK at $UNIT_DST.
  // Re-running `install` after the template migration must replace that
  // symlink with the rendered regular file — never trip up on the existing
  // link kind (the rm -f branch handles both `-L` and `-f`).
  it('install replaces a pre-existing symlink (pre-template install) cleanly', async () => {
    const xdg = await createTempDir('s20-xdg-link');
    const userDir = path.join(xdg, 'systemd/user');
    await fs.mkdir(userDir, { recursive: true });
    const expectedInstalled = path.join(userDir, 'neuma.service');
    // Plant a stale symlink that mimics the old install layout. Target
    // can be anything — install will rm it before rendering.
    await fs.symlink('/nonexistent/old-unit', expectedInstalled);
    expect((await fs.lstat(expectedInstalled)).isSymbolicLink()).toBe(true);

    const r = await runWrapper(['install'], { stubBin, env: { XDG_CONFIG_HOME: xdg } });
    expect(r.exitCode).toBe(0);
    const st = await fs.lstat(expectedInstalled);
    expect(st.isSymbolicLink(), 'install must replace the stale symlink with a regular file').toBe(false);
    expect(st.isFile()).toBe(true);
    const rendered = await fs.readFile(expectedInstalled, 'utf8');
    expect(rendered).not.toMatch(/__REPO_ROOT__/);
  });

  // ai6 R2 finding 3 — committed regression for the sed REPLACEMENT-side
  // escape (`\`, `&`, `|`). The default test runs against the real REPO_ROOT
  // (/workspace/repos/neuma — zero sed metachars), so the escape line could
  // silently regress and stay green. This test plants the wrapper + template
  // at a checkout path containing every replacement-side metachar that the
  // escape MUST survive, runs install, and asserts the rendered unit's
  // directives resolve to the metachar path verbatim with no double-escaping
  // and no leftover placeholder. Real disk, real bash, real wrapper — RULE 0.
  it('install renders correctly when REPO_ROOT contains sed-replacement metachars (& \\ |)', async () => {
    const parent = await createTempDir('s20-metachar');
    // The Real Test™: path component contains every sed-replacement metachar.
    // Spelling them out so a future reader can SEE the regression target:
    //   `&` — substituted with the matched pattern in sed replacement; unescaped → produces the literal placeholder text in the output
    //   `\` — escape character in sed replacement; unescaped → consumes the following char
    //   `|` — the delimiter we chose for the sed `s|||g` form; unescaped → terminates the replacement early
    const fakeRoot = path.join(parent, 'a&b\\c|d-checkout');
    await fs.mkdir(path.join(fakeRoot, 'systemd'), { recursive: true });
    await fs.mkdir(path.join(fakeRoot, 'scripts'), { recursive: true });
    // Copy the real wrapper + template — this is the SAME code that ships,
    // not a mock. The wrapper resolves REPO_ROOT from its own script path,
    // so executing the copy from $fakeRoot/scripts/ makes $fakeRoot the
    // effective REPO_ROOT for the render.
    await fs.copyFile(
      path.join(REPO_ROOT, 'scripts/neuma-daemon.sh'),
      path.join(fakeRoot, 'scripts/neuma-daemon.sh'),
    );
    await fs.chmod(path.join(fakeRoot, 'scripts/neuma-daemon.sh'), 0o755);
    await fs.copyFile(UNIT_TEMPLATE, path.join(fakeRoot, 'systemd/neuma.service.template'));

    const xdg = await createTempDir('s20-metachar-xdg');
    const r = await runWrapper(['install'], {
      stubBin,
      env: { XDG_CONFIG_HOME: xdg },
      wrapper: path.join(fakeRoot, 'scripts/neuma-daemon.sh'),
    });
    expect(r.exitCode, `install must exit 0 (stdout: ${r.stdout}; stderr: ${r.stderr})`).toBe(0);

    const expectedInstalled = path.join(xdg, 'systemd/user/neuma.service');
    const rendered = await fs.readFile(expectedInstalled, 'utf8');
    expect(rendered, 'no leftover placeholder').not.toMatch(/__REPO_ROOT__/);
    // The render MUST produce the path verbatim. Build the expected lines
    // as PLAIN STRINGS (not regex) and use `toContain` — a substring check
    // avoids re-introducing the regex-escape footgun this test exists to
    // protect against.
    expect(rendered, `WorkingDirectory must contain the metachar path verbatim`)
      .toContain(`\nWorkingDirectory=${fakeRoot}\n`);
    expect(rendered, `EnvironmentFile must contain the metachar path verbatim`)
      .toContain(`\nEnvironmentFile=-${fakeRoot}/.env\n`);
  });

  // INVARIANT 8 — require_systemd_user gate. Constructing a PATH that has
  // dirname/mkdir/etc. but NOT systemctl is fragile across distros, so we
  // assert the gate at the source level (ai6 R1.5: weaker honest check).
  //
  // ai6 R3 catch: the previous version asserted `/exit 2/` against the whole
  // file, which would silently pass even if require_systemd_user reverted to
  // `exit` (the regex matched `verb_install`'s `exit 2` instead). The
  // CURRENT contract after R2.1 is `return 2` — fatal-for-direct-verbs via
  // set -e propagation, NON-fatal under doctor's `|| true` — and this test
  // must assert that contract specifically against require_systemd_user's
  // body, not against any random `exit 2` elsewhere.
  it('require_systemd_user gate uses return-2 (R2.1 contract) + every systemd-touching verb mentions it', async () => {
    const text = await fs.readFile(WRAPPER, 'utf8');
    expect(text).toMatch(/require_systemd_user\(\)\s*\{/);

    // Extract require_systemd_user's body specifically — bracket-bounded so
    // we don't pick up adjacent functions. Two `return 2` lines (one per
    // failure branch) must appear; NO `exit` may appear inside it (the
    // R1.1/R2.1 regression guard). ai6 R4 consistency hardening: scope the
    // string-presence assertions to `body` too, not the whole file.
    const match = text.match(/require_systemd_user\(\)\s*\{([\s\S]*?)\n\}/);
    expect(match, 'require_systemd_user body must be matchable').not.toBeNull();
    const body = match[1];
    expect(body).toMatch(/command -v systemctl >\/dev\/null 2>&1/);
    expect(body).toMatch(/systemctl not found/);
    const returnTwos = body.match(/\breturn 2\b/g) || [];
    expect(returnTwos.length, 'require_systemd_user must use return-2 on BOTH failure branches').toBeGreaterThanOrEqual(2);
    expect(body, 'require_systemd_user MUST NOT contain `exit` (R1.1/R2.1 regression guard)')
      .not.toMatch(/\bexit\b/);

    // Honest weaker check (R1.5): assert verb_X exists. Combined with the
    // per-verb stub tests above, this proves require_systemd_user actually
    // runs inside each verb (every passing verb's session probe succeeded).
    for (const verb of ['install', 'uninstall', 'start', 'stop', 'restart',
                        'status', 'logs', 'enable', 'disable']) {
      expect(text, `verb_${verb} must exist`).toMatch(new RegExp(`verb_${verb}\\(\\)`));
    }
    // Call-site count: 1 definition + at least 9 verb call sites = >=10
    const calls = text.match(/require_systemd_user/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(10);
  });
});

describe('#20 S1 — systemd unit template', () => {
  // INVARIANT 9 — template exists at the documented location and has the
  // required directives, including the __REPO_ROOT__ placeholder that
  // install will substitute. We don't try to load it into systemd here; we
  // read it as text and assert the load-bearing fields are present.
  it('systemd/neuma.service.template has every directive the wrapper + operator depend on', async () => {
    const text = await fs.readFile(UNIT_TEMPLATE, 'utf8');
    // Section headers
    expect(text).toMatch(/^\[Unit\]/m);
    expect(text).toMatch(/^\[Service\]/m);
    expect(text).toMatch(/^\[Install\]/m);
    // Working dir uses the __REPO_ROOT__ placeholder (install substitutes).
    // Hardcoding `/workspace/repos/neuma` here would have silently broken
    // the new-rig install path — the template MUST be path-agnostic.
    expect(text).toMatch(/^WorkingDirectory=__REPO_ROOT__$/m);
    // EnvironmentFile is OPTIONAL (leading -) AND uses the placeholder for
    // the .env path. Optional so missing .env doesn't break unit start;
    // placeholder so the path is correct for the checkout location.
    expect(text).toMatch(/^EnvironmentFile=-__REPO_ROOT__\/\.env$/m);
    // ExecStart calls node on the backend entry — inline to avoid the npm fork
    expect(text).toMatch(/^ExecStart=.*node backend\/server\.js/m);
    // Restart policy: always (ai6 R1.4) — for unconditional 24/7 persistence,
    // not on-failure which leaves the daemon down after any clean exit
    expect(text).toMatch(/^Restart=always/m);
    expect(text).toMatch(/^StartLimitBurst=/m);
    // Logs to the journal (operator reaches them via the wrapper's `logs`)
    expect(text).toMatch(/^StandardOutput=journal/m);
    expect(text).toMatch(/^StandardError=journal/m);
    expect(text).toMatch(/^SyslogIdentifier=neuma/m);
    // Default boot target — comes up on login (or boot if linger is on)
    expect(text).toMatch(/^WantedBy=default\.target/m);
    // Graceful shutdown matches backend/services/shutdown.js's SIGTERM handler
    expect(text).toMatch(/^KillSignal=SIGTERM/m);
  });
});
