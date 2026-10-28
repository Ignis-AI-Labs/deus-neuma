/**
 * The mac build contract: the packaging chain and the settings that must survive
 * an edit. Read from the real package.json and electron-builder.yml, and the
 * real entitlements plist — no mocks, and no copy of the config in this file.
 *
 * The failure this prevents is quiet: a chain link dropped in a tidy-up ("the
 * ABI step is only for Linux"), or an entitlement lost while merging the plist,
 * shows up as an app that dies at boot on the one chip nobody is testing.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const builder = yaml.load(fs.readFileSync(path.join(REPO, 'electron-builder.yml'), 'utf8'));
const entitlements = fs.readFileSync(path.join(REPO, 'build/entitlements.mac.plist'), 'utf8');

describe('one artifact per chip', () => {
  it('builds dmg and zip for both chips and neither of them universal', () => {
    expect(builder.mac.target).toEqual([
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ]);
    // A universal app would need fat addons; the native modules are per-arch.
    expect(JSON.stringify(builder.mac.target)).not.toContain('universal');
  });

  it('names the chip in every artifact, so the two cannot overwrite each other', () => {
    expect(builder.artifactName).toContain('${arch}');
  });
});

describe('the packaging chain', () => {
  const script = (name) => pkg.scripts[name] || '';

  it.each(['dist:linux', 'dist:deb', 'dist:rpm', 'dist:win', 'dist:mac'])(
    '%s rebuilds the native addons for Electron before packaging',
    (name) => {
      expect(script(`pre${name}`)).toContain('ensure-native-abi.mjs electron');
    },
  );

  it('dist:mac checks what it just built, and the check is also reachable alone', () => {
    expect(script('dist:mac')).toContain('electron-builder --mac');
    expect(script('dist:mac')).toContain('check-mac-artifacts.mjs');
    expect(script('check:mac')).toContain('check-mac-artifacts.mjs');
    // the check comes after packaging: a pre-check would judge the old artifacts
    expect(script('dist:mac').indexOf('check-mac-artifacts.mjs'))
      .toBeGreaterThan(script('dist:mac').indexOf('electron-builder --mac'));
  });

  it('the build runs before packaging, never after', () => {
    for (const name of ['dist:linux', 'dist:win', 'dist:mac']) {
      expect(script(name).indexOf('npm run build'))
        .toBeLessThan(script(name).indexOf('electron-builder'));
    }
  });
});

describe('the mac settings the app boots with', () => {
  it('keeps the hardened runtime and applies the entitlements to the children too', () => {
    expect(builder.mac.hardenedRuntime).toBe(true);
    expect(builder.mac.gatekeeperAssess).toBe(false);
    expect(builder.mac.entitlements).toBe('build/entitlements.mac.plist');
    expect(builder.mac.entitlementsInherit).toBe('build/entitlements.mac.plist');
  });

  it('keeps the four entitlements the spawned backend child needs', () => {
    for (const key of [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.device.audio-input',
    ]) {
      expect(entitlements).toContain(`<key>${key}</key>`);
    }
  });

  it('keeps the microphone usage string, without which the first press-to-talk is refused', () => {
    expect(builder.mac.extendInfo.NSMicrophoneUsageDescription).toMatch(/microphone|listen|speak/i);
  });

  it('ships unpacked, because the backend is a spawned Node child that cannot read asar', () => {
    expect(builder.asar).toBe(false);
  });
});

describe('the update feed a mac build serves', () => {
  it('publishes to the generic HTTPS feed under the latest channel', () => {
    expect(builder.publish).toMatchObject({
      provider: 'generic',
      url: 'https://deusneuma.ai/updates/',
      channel: 'latest',
    });
  });

  it('the shell still names the same feed host it will fetch from', () => {
    const autoUpdate = fs.readFileSync(path.join(REPO, 'electron/auto-update.cjs'), 'utf8');
    expect(autoUpdate).toContain(builder.publish.url);
  });
});
