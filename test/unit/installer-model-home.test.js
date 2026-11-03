// The uninstaller stops processes in, and deletes, the model folder only when setup marked it and it
// is not a place whose loss would harm the PC. The folder's path comes back from HKCU, which anything
// the person runs can rewrite, while an all-users uninstall runs elevated. Reads the real
// build/installer.nsh; NSIS is not run here (the guard was compiled and run under Wine when written).
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const NSH = fs.readFileSync(path.resolve(import.meta.dirname, '../../build/installer.nsh'), 'utf8');
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

  test('the uninstaller judges the folder before it stops anything in it or deletes it', () => {
    const uninstall = block('!macro customUnInstall');
    const read = uninstall.indexOf('ReadRegStr $0 HKCU "${DN_REG}" "ModelHome"');
    const verdict = uninstall.indexOf('!insertmacro DnModelHomeVerdict "$0" $2');
    const refuse = uninstall.indexOf('StrCpy $0 ""', verdict);
    const gate = uninstall.indexOf('${If} $0 != ""', refuse);
    const kill = uninstall.indexOf("Name='ollama.exe'");
    const remove = uninstall.indexOf('RMDir /r "$0"');
    for (const at of [read, verdict, refuse, gate, kill, remove]) expect(at).toBeGreaterThan(-1);
    expect(read < verdict && verdict < refuse && refuse < gate && gate < kill && kill < remove).toBe(true);
    expect(uninstall.match(/RMDir \/r/g)).toHaveLength(1);
  });
});
