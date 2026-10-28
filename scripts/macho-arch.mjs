/**
 * macho-arch.mjs — what chip a Mach-O binary is built for, read from its header.
 *
 * WHY: an Electron app carries its native modules as compiled Mach-O addons
 * (better_sqlite3.node, pty.node, the onnxruntime dylib) and the app itself as
 * more Mach-O. Electron cannot load an addon built for the other chip, and the
 * failure looks like a crash at boot, not like a packaging mistake. The mac
 * build makes one artifact per chip, so every artifact must be checked: its
 * addons are the chip the artifact claims and not the chip of the machine that
 * built it.
 *
 * Pure: bytes in, answer out. The caller reads the header (4 KB is plenty —
 * a fat header names every slice up front), so no fs here and the reader can be
 * proven against a real binary and against bytes made in a test.
 *
 * A FAT binary answers with every slice it holds; an artifact is right when the
 * chip it claims is among them.
 */

// cputype values from <mach/machine.h>. Only the ones a mac build can meet.
const CPU_NAMES = new Map([
  [7, 'x86'],
  [0x01000007, 'x86_64'],
  [12, 'arm'],
  [0x0100000c, 'arm64'],
]);

/**
 * The eight magics, as the four bytes that appear at the start of the file.
 * Mach-O is written in the byte order of the machine that produced it, so the
 * same magic appears reversed when the producer's order differs from the
 * reader's; both are listed rather than guessed.
 */
const MAGICS = new Map([
  ['cffaedfe', { kind: 'thin', endian: 'le' }], // MH_MAGIC_64
  ['cefaedfe', { kind: 'thin', endian: 'le' }], // MH_MAGIC
  ['feedfacf', { kind: 'thin', endian: 'be' }], // MH_CIGAM_64
  ['feedface', { kind: 'thin', endian: 'be' }], // MH_CIGAM
  ['cafebabe', { kind: 'fat', endian: 'be', stride: 20 }], // FAT_MAGIC
  ['cafebabf', { kind: 'fat', endian: 'be', stride: 32 }], // FAT_MAGIC_64
  ['bebafeca', { kind: 'fat', endian: 'le', stride: 20 }], // FAT_CIGAM
  ['bfbafeca', { kind: 'fat', endian: 'le', stride: 32 }], // FAT_CIGAM_64
]);

const HEADER_BYTES = 8;

const readU32 = (bytes, offset, endian) =>
  endian === 'le' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);

const nameOf = (cputype) => CPU_NAMES.get(cputype >>> 0) || `cputype:0x${(cputype >>> 0).toString(16)}`;

/**
 * @param {Buffer} bytes at least the first 4 KB of the file
 * @returns {{format: 'thin'|'fat', archs: string[]}|null} null when the file is
 *   not Mach-O at all (a text file, an ELF, an empty file, a truncated header)
 */
export function archsOf(bytes) {
  if (!bytes || bytes.length < HEADER_BYTES) return null;
  const magic = bytes.subarray(0, 4).toString('hex');
  const spec = MAGICS.get(magic);
  if (!spec) return null;

  if (spec.kind === 'thin') {
    return { format: 'thin', archs: [nameOf(readU32(bytes, 4, spec.endian))] };
  }

  const count = readU32(bytes, 4, spec.endian);
  // A fat header claiming more slices than the buffer holds is truncated, not
  // empty: say so by answering null rather than a short list that would pass.
  if (count === 0 || 8 + count * spec.stride > bytes.length) return null;
  const archs = [];
  for (let i = 0; i < count; i += 1) {
    archs.push(nameOf(readU32(bytes, 8 + i * spec.stride, spec.endian)));
  }
  return { format: 'fat', archs };
}

/** The header read the callers need: enough for any realistic fat header. */
export const ARCH_HEADER_BYTES = 4096;

/** True when the binary can be loaded on `chip`. */
export function holdsChip(bytes, chip) {
  const found = archsOf(bytes);
  return !!found && found.archs.includes(chip);
}

export { CPU_NAMES, MAGICS };
