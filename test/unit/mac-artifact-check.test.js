/**
 * The artifact check, proven on real bundles assembled in a temp directory from
 * real Mach-O headers. No mock: each case writes bytes to disk, then the same
 * function the build would call walks the directory and answers.
 *
 * The case that matters is the quiet one — an arm64 artifact carrying an x64
 * addon, which loads fine on the builder's machine and dies on the other chip.
 */
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bundlesUnder, expectedChipFor, inspectBundle, main, signatureOf, verdictFor,
} from '../../scripts/check-mac-artifacts.mjs';

const ARM64 = 0x0100000c;
const X86_64 = 0x01000007;

/** A real thin Mach-O header for one cputype. */
function macho(cputype) {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(0xfeedfacf, 0);
  buf.writeUInt32LE(cputype >>> 0, 4);
  return buf;
}

const roots = [];
const tempRoot = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-mac-artifacts-'));
  roots.push(dir);
  return dir;
};

/**
 * Lay out an app bundle the way electron-builder does:
 *   <release>/<mac-arm64|mac|mac-universal>/NEUMA.app/Contents/…
 */
function bundle({ release, dirName, exe, addon, extra = {} }) {
  const app = path.join(release, dirName, 'NEUMA.app');
  const put = (rel, bytes) => {
    const file = path.join(app, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  };
  put('Contents/MacOS/NEUMA', macho(exe));
  put('Contents/Resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node', macho(addon));
  put('Contents/Resources/app/node_modules/node-pty/build/Release/pty.node', macho(addon));
  // Not binaries: they must be skipped, not judged.
  put('Contents/Resources/app/package.json', '{"name":"neuma"}\n');
  put('Contents/Frameworks/Electron Framework.framework/Resources/Info.plist', '<plist/>\n');
  for (const [rel, bytes] of Object.entries(extra)) put(rel, bytes);
  return app;
}

afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

describe('which chip a directory claims', () => {
  it('reads electron-builder\'s own naming', () => {
    expect(expectedChipFor('mac-arm64')).toBe('arm64');
    expect(expectedChipFor('mac-x64')).toBe('x86_64');
    expect(expectedChipFor('mac')).toBe('x86_64'); // the older builder's name for x64
    expect(expectedChipFor('mac-universal')).toBe('universal');
    expect(expectedChipFor('linux-unpacked')).toBeNull();
    expect(expectedChipFor('win-unpacked')).toBeNull();
  });
});

describe('does a binary hold the chip', () => {
  it('accepts the chip, refuses the other, and asks a universal bundle for both', () => {
    expect(verdictFor('arm64', ['arm64']).ok).toBe(true);
    expect(verdictFor('arm64', ['x86_64'])).toEqual({ ok: false, missing: ['arm64'] });
    expect(verdictFor('x86_64', ['x86_64']).ok).toBe(true);
    expect(verdictFor('universal', ['arm64', 'x86_64']).ok).toBe(true);
    expect(verdictFor('universal', ['arm64'])).toEqual({ ok: false, missing: ['x86_64'] });
  });
});

describe('a bundle whose addons match its chip', () => {
  it('passes, and judges only the binaries', () => {
    const release = tempRoot();
    const app = bundle({ release, dirName: 'mac-arm64', exe: ARM64, addon: ARM64 });
    const found = inspectBundle(app, 'arm64');

    expect(found.mismatches).toEqual([]);
    // the executable and both addons, and nothing of the JSON or the plist
    expect(found.macho).toEqual([
      path.join('Contents/MacOS/NEUMA'),
      path.join('Contents/Resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
      path.join('Contents/Resources/app/node_modules/node-pty/build/Release/pty.node'),
    ]);
    expect(found.files).toBeGreaterThan(found.macho.length);
  });

  it('finds a framework binary too, however deep it sits', () => {
    const release = tempRoot();
    const app = bundle({
      release,
      dirName: 'mac-arm64',
      exe: ARM64,
      addon: ARM64,
      extra: { 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework': macho(ARM64) },
    });
    const found = inspectBundle(app, 'arm64');
    expect(found.macho).toContain(
      path.join('Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'),
    );
    expect(found.mismatches).toEqual([]);
  });
});

describe('a bundle that carries the other chip', () => {
  it('names the addon and the chip it lacks', () => {
    const release = tempRoot();
    const app = bundle({ release, dirName: 'mac-arm64', exe: ARM64, addon: X86_64 });
    const found = inspectBundle(app, 'arm64');

    expect(found.mismatches).toHaveLength(2); // both addons
    expect(found.mismatches[0].archs).toEqual(['x86_64']);
    expect(found.mismatches[0].missing).toEqual(['arm64']);
    expect(found.mismatches[0].file).toContain('better_sqlite3.node');
  });

  it('catches an executable built for the other chip', () => {
    const release = tempRoot();
    const app = bundle({ release, dirName: 'mac', exe: ARM64, addon: X86_64 });
    const found = inspectBundle(app, 'x86_64');
    expect(found.mismatches.map((m) => path.basename(m.file))).toEqual(['NEUMA']);
  });

  it('refuses a thin binary in a bundle that promises universal', () => {
    const release = tempRoot();
    const app = bundle({ release, dirName: 'mac-universal', exe: ARM64, addon: ARM64 });
    const found = inspectBundle(app, 'universal');
    expect(found.mismatches).toHaveLength(3);
    expect(found.mismatches[0].missing).toEqual(['x86_64']);
  });
});

describe('finding the bundles and judging their signature', () => {
  it('finds one per chip directory and none elsewhere', () => {
    const release = tempRoot();
    bundle({ release, dirName: 'mac-arm64', exe: ARM64, addon: ARM64 });
    bundle({ release, dirName: 'mac', exe: X86_64, addon: X86_64 });
    fs.mkdirSync(path.join(release, 'linux-unpacked'), { recursive: true });

    const found = bundlesUnder(release);
    expect(found.map((b) => [b.dirName, b.chip]).sort()).toEqual([
      ['mac', 'x86_64'],
      ['mac-arm64', 'arm64'],
    ]);
    expect(bundlesUnder(path.join(release, 'nowhere'))).toEqual([]);
  });

  it('says unsigned when there is no seal, and never claims a signature it did not see', () => {
    const release = tempRoot();
    const app = bundle({ release, dirName: 'mac-arm64', exe: ARM64, addon: ARM64 });
    const sig = signatureOf(app);
    expect(sig.signed).toBe(false);
    expect(sig.why).toContain('_CodeSignature');
  });
});

describe('the exit code a build would read', () => {
  it('0 when every artifact matches its chip', () => {
    const release = tempRoot();
    bundle({ release, dirName: 'mac-arm64', exe: ARM64, addon: ARM64 });
    bundle({ release, dirName: 'mac', exe: X86_64, addon: X86_64 });
    expect(main(['--release', release])).toBe(0);
  });

  it('1 when one artifact carries the other chip', () => {
    const release = tempRoot();
    bundle({ release, dirName: 'mac-arm64', exe: ARM64, addon: ARM64 });
    bundle({ release, dirName: 'mac', exe: X86_64, addon: ARM64 }); // the quiet failure
    expect(main(['--release', release])).toBe(1);
  });

  it('1 when asked to require a signature that is not there', () => {
    const release = tempRoot();
    bundle({ release, dirName: 'mac-arm64', exe: ARM64, addon: ARM64 });
    expect(main(['--release', release])).toBe(0);
    expect(main(['--release', release, '--require-signed'])).toBe(1);
  });

  it('1 when there is no artifact to check', () => {
    const release = tempRoot();
    expect(main(['--release', release])).toBe(1);
  });
});
