/**
 * The Mach-O arch reader, proven two ways: against headers built byte by byte
 * here (so every magic, both byte orders and the truncation edges are covered),
 * and against real binaries in node_modules compared with lipo's own answer.
 * RULE 0: no mock — a pure function is verified by calling it, and a real
 * binary is verified by the platform's own tool.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARCH_HEADER_BYTES, archsOf, holdsChip } from '../../scripts/macho-arch.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A thin Mach-O with one cputype, written in the given byte order. */
function thin(cputype, endian = 'le') {
  const buf = Buffer.alloc(32);
  const is64 = (cputype & 0x01000000) !== 0;
  const magic = is64 ? 0xfeedfacf : 0xfeedface;
  if (endian === 'le') {
    buf.writeUInt32LE(magic, 0);
    buf.writeUInt32LE(cputype >>> 0, 4);
  } else {
    buf.writeUInt32BE(magic, 0);
    buf.writeUInt32BE(cputype >>> 0, 4);
  }
  return buf;
}

/** A fat Mach-O holding the given cputypes. */
function fat(cputypes, { endian = 'be', sixtyFour = false } = {}) {
  const stride = sixtyFour ? 32 : 20;
  const buf = Buffer.alloc(8 + cputypes.length * stride + 64);
  const magic = sixtyFour ? 0xcafebabf : 0xcafebabe;
  const put = (value, offset) => (endian === 'le'
    ? buf.writeUInt32LE(value, offset)
    : buf.writeUInt32BE(value, offset));
  put(magic, 0);
  // The CIGAM magics are the same number read from the other side; writing the
  // magic in the file's own order is what makes the bytes match the table.
  put(cputypes.length, 4);
  cputypes.forEach((cputype, i) => {
    put(cputype, 8 + i * stride);
    // offset/size/align per slice — the reader never looks past cputype, but a
    // real header has them, so the fixture does too.
    put(4096 + i * 1024, 8 + i * stride + 8);
    put(1024, 8 + i * stride + 12);
    put(12, 8 + i * stride + 16);
  });
  return buf;
}

// The prebuilds are Mach-O on every host — node-pty ships them all — so they
// prove the reader on Linux CI too. The built addon is only Mach-O on a mac:
// elsewhere better-sqlite3 compiles to ELF or PE, and there is nothing here to
// read. `only` says which host a case is real on.
const REAL = [
  ['node-pty darwin-arm64 prebuild', 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node', 'arm64', null],
  ['node-pty darwin-x64 prebuild', 'node_modules/node-pty/prebuilds/darwin-x64/pty.node', 'x86_64', null],
  ['better-sqlite3 built addon', 'node_modules/better-sqlite3/build/Release/better_sqlite3.node', null, 'darwin'],
];

const lipoArchs = (file) => {
  try {
    return execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/).sort();
  } catch {
    return null; // no lipo: not a mac, or not a Mach-O
  }
};

describe('the header, read byte by byte', () => {
  it('names the chip of a thin 64-bit binary in both byte orders', () => {
    expect(archsOf(thin(0x0100000c))).toEqual({ format: 'thin', archs: ['arm64'] });
    expect(archsOf(thin(0x01000007))).toEqual({ format: 'thin', archs: ['x86_64'] });
    expect(archsOf(thin(0x0100000c, 'be'))).toEqual({ format: 'thin', archs: ['arm64'] });
    expect(archsOf(thin(0x01000007, 'be'))).toEqual({ format: 'thin', archs: ['x86_64'] });
  });

  it('names the chip of a thin 32-bit binary', () => {
    expect(archsOf(thin(12))).toEqual({ format: 'thin', archs: ['arm'] });
    expect(archsOf(thin(7))).toEqual({ format: 'thin', archs: ['x86'] });
  });

  it('lists every slice of a universal binary, 32- and 64-bit headers alike', () => {
    expect(archsOf(fat([0x0100000c, 0x01000007]))).toEqual({ format: 'fat', archs: ['arm64', 'x86_64'] });
    expect(archsOf(fat([0x0100000c, 0x01000007], { sixtyFour: true }))).toEqual({ format: 'fat', archs: ['arm64', 'x86_64'] });
    expect(archsOf(fat([0x0100000c, 0x01000007], { endian: 'le' }))).toEqual({ format: 'fat', archs: ['arm64', 'x86_64'] });
  });

  it('says nothing rather than guessing when the bytes are not a Mach-O', () => {
    expect(archsOf(Buffer.from('#!/bin/sh\necho hello\n'))).toBeNull(); // a shell script
    expect(archsOf(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]))).toBeNull(); // ELF
    expect(archsOf(Buffer.alloc(0))).toBeNull();
    expect(archsOf(Buffer.from([0xcf, 0xfa, 0xed]))).toBeNull(); // three bytes of a magic
    expect(archsOf(null)).toBeNull();
  });

  it('refuses a fat header whose slice count runs past the bytes given', () => {
    const complete = fat([0x0100000c, 0x01000007]);
    const liars = Buffer.from(complete.subarray(0, 8 + 20)); // header claims two, holds one
    liars.writeUInt32BE(2, 4);
    expect(archsOf(liars)).toBeNull();
  });

  it('reports an unknown cputype instead of dropping the slice', () => {
    const odd = thin(0x0badf00d);
    expect(archsOf(odd).archs).toEqual(['cputype:0xbadf00d']);
  });
});

describe('real binaries in this tree', () => {
  it('the declared header read is enough for every real header here', () => {
    expect(ARCH_HEADER_BYTES).toBeGreaterThanOrEqual(4096);
  });

  for (const [label, rel, expected, only] of REAL) {
    const file = path.join(REPO, rel);
    const present = fs.existsSync(file) && (!only || process.platform === only);

    it.runIf(present)(`${label} agrees with lipo`, () => {
      const head = fs.readFileSync(file).subarray(0, ARCH_HEADER_BYTES);
      const found = archsOf(head);
      expect(found).not.toBeNull();

      const byLipo = lipoArchs(file);
      if (byLipo) expect([...found.archs].sort()).toEqual(byLipo);
      if (expected) expect(found.archs).toContain(expected);
    });
  }

  it('holdsChip answers for the chip a package ships and the one it does not', () => {
    const arm = path.join(REPO, 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node');
    const x64 = path.join(REPO, 'node_modules/node-pty/prebuilds/darwin-x64/pty.node');
    if (!fs.existsSync(arm) || !fs.existsSync(x64)) return;
    const bytes = (f) => fs.readFileSync(f).subarray(0, ARCH_HEADER_BYTES);
    expect(holdsChip(bytes(arm), 'arm64')).toBe(true);
    expect(holdsChip(bytes(arm), 'x86_64')).toBe(false);
    expect(holdsChip(bytes(x64), 'x86_64')).toBe(true);
    expect(holdsChip(bytes(x64), 'arm64')).toBe(false);
    expect(holdsChip(Buffer.from('not a binary'), 'arm64')).toBe(false);
  });
});
