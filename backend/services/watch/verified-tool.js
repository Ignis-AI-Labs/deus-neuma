import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

const digest = async (stream) => {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
};

/** The SHA-256 of a file on disk. impure */
export const fileSha256 = async (file) => (await digest(fs.createReadStream(file))).sha256;

/** Whether a file's real bytes have the expected SHA-256. impure */
export const matchesSha256 = async (file, expected) => await fileSha256(file) === expected;

/** Whether a gzip expands to exactly the executable on disk. impure */
export const gzipMatchesFile = async (gz, file) => {
  const [packed, unpacked] = await Promise.all([
    digest(fs.createReadStream(gz).pipe(zlib.createGunzip())),
    digest(fs.createReadStream(file)),
  ]);
  return packed.bytes === unpacked.bytes && packed.sha256 === unpacked.sha256;
};
