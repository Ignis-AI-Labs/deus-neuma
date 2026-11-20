// The model-home guard reads the real NSIS and PowerShell sources everywhere; on Windows the helper
// also runs against real directories and NTFS junctions. NSIS itself still needs its installer lane.
import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NSH = fs.readFileSync(path.resolve(import.meta.dirname, '../../build/installer.nsh'), 'utf8');
const HELPER_PATH = path.resolve(import.meta.dirname, '../../build/installer-model-home.ps1');
const HELPER = fs.readFileSync(HELPER_PATH, 'utf8');
const block = (start) => {
  const from = NSH.indexOf(start);
  return NSH.slice(from, NSH.indexOf('!macroend', from));
};

describe('build/installer.nsh — the model folder', () => {
  test('setup writes its mark into the folder it chose, beside the registry value', () => {
    const install = block('!macro customInstall');
    const reg = install.indexOf('WriteRegStr HKCU "${DN_REG}" "ModelHome" "$ModelHome"');
    const mark = install.indexOf('FileOpen $1 "$ModelHome\\${DN_MODEL_MARK}" w');
    expect(reg).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(reg);
    expect(install.indexOf('CreateDirectory "$ModelHome"')).toBeGreaterThan(reg);
    expect(install.indexOf('FileClose $1', mark)).toBeGreaterThan(mark);
    expect(NSH).toContain('!define DN_MODEL_MARK ".deus-neuma-model-home"');
  });

  test('the guard needs the mark, a full path, and none of the protected places', () => {
    const guard = block('!macro DnModelHomeVerdict');
    expect(guard).toContain('${ElseIfNot} ${FileExists} "$R0\\${DN_MODEL_MARK}"');
    expect(guard).toContain('StrCpy ${VERDICT} "it is a whole drive"');
    expect(guard).toContain('StrCpy ${VERDICT} "it is not a full path on a drive"');
    for (const place of ['$WINDIR', '$PROGRAMFILES', '$PROGRAMFILES64', '$PROFILE', '$INSTDIR']) {
      expect(guard).toContain(`!insertmacro DnCovers "${place}" \${VERDICT}`);
    }
    expect(guard).toContain('StrCpy ${VERDICT} "it is inside Windows"');
  });

  test('reparse checks precede the managed stop, and only known children are recursive deletes', () => {
    const uninstall = block('!macro customUnInstall');
    const verdict = uninstall.indexOf('!insertmacro DnModelHomeVerdict "$0" $2');
    const load = uninstall.indexOf('installer-model-home.ps1');
    const invoke = uninstall.indexOf('-StopKnownServer -RemoveKnownChildren $3');
    expect(load).toBeGreaterThan(-1);
    expect(verdict).toBeGreaterThan(load);
    expect(invoke).toBeGreaterThan(verdict);
    expect(uninstall).not.toContain('RMDir /r');
    expect(HELPER.indexOf('Assert-NoReparsePoint $env:DN_MODEL_HOME')).toBeGreaterThan(-1);
    expect(HELPER.indexOf('Assert-NoReparsePoint $env:DN_MODEL_HOME')).toBeLessThan(HELPER.indexOf('Get-CimInstance Win32_Process'));
    expect(HELPER.indexOf('Get-CimInstance Win32_Process')).toBeLessThan(HELPER.indexOf('if ($RemoveKnownChildren -eq 1)'));
    expect(HELPER.match(/Remove-Item -LiteralPath \$child -Recurse -Force/g)).toHaveLength(1);
    expect(HELPER).toContain("foreach ($name in 'ollama', 'models')");
    expect(HELPER).toContain("foreach ($name in 'ollama.log', '.deus-neuma-model-home')");
    expect(HELPER).toContain('Get-ChildItem -LiteralPath $env:DN_MODEL_HOME -Force');
    expect(HELPER).toContain('Remove-Item -LiteralPath $env:DN_MODEL_HOME -Force');
  });
});

const onWindows = process.platform === 'win32';
const powershell = () => path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const run = (home, args = []) => spawnSync(powershell(), [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER_PATH,
  '-RemoveKnownChildren', '1', ...args,
], { env: { ...process.env, DN_MODEL_HOME: home }, encoding: 'utf8', timeout: 30_000 });

describe.skipIf(!onWindows)('the model-home helper on real NTFS directories', () => {
  test('a legitimate home loses only managed payload; unknown files keep the home in place', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-home-ok-'));
    const home = path.join(base, 'home');
    for (const child of ['ollama', 'models']) fs.mkdirSync(path.join(home, child), { recursive: true });
    fs.writeFileSync(path.join(home, 'ollama.log'), 'log');
    fs.writeFileSync(path.join(home, '.deus-neuma-model-home'), 'mark');
    fs.writeFileSync(path.join(home, 'keep.txt'), 'not setup payload');
    const result = run(home);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(fs.existsSync(path.join(home, 'ollama'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'models'))).toBe(false);
    expect(fs.readFileSync(path.join(home, 'keep.txt'), 'utf8')).toBe('not setup payload');
    fs.rmSync(path.join(home, 'keep.txt'));
    expect(run(home).status).toBe(0);
    expect(fs.existsSync(home)).toBe(false);
    fs.rmSync(base, { recursive: true, force: true });
  });

  test.each(['home', 'ancestor', 'ollama', 'models'])('a junction at %s refuses before deletion', (where) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-home-junction-'));
    const victim = path.join(base, 'victim');
    const realHome = path.join(base, 'real-home');
    fs.mkdirSync(victim);
    fs.mkdirSync(realHome);
    fs.writeFileSync(path.join(victim, 'keep.txt'), 'must survive');
    let home = realHome;
    if (where === 'home') {
      home = path.join(base, 'linked-home');
      fs.symlinkSync(realHome, home, 'junction');
    } else if (where === 'ancestor') {
      const linkedParent = path.join(base, 'linked-parent');
      fs.symlinkSync(base, linkedParent, 'junction');
      home = path.join(linkedParent, 'real-home');
    } else {
      fs.symlinkSync(victim, path.join(realHome, where), 'junction');
    }
    const result = run(home);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(fs.readFileSync(path.join(victim, 'keep.txt'), 'utf8')).toBe('must survive');
    expect(fs.existsSync(realHome)).toBe(true);
    fs.rmSync(base, { recursive: true, force: true });
  });
});
