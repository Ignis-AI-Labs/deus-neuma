// publish-site release check — a release folder the site may serve, proven on real files written to
// disk the way electron-builder writes them (feed sha512 base64 + size) and sha256sum writes
// SHA256SUMS. A feed or checksum that disagrees with its bytes must never reach the bucket.
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { checkRelease, contentTypeOf } from '../../scripts/publish-site/release-check.mjs';

const V = '0.1.30';
const APP = `Deus-Neuma-${V}-x86_64.AppImage`;
const DEB = `neuma_${V}_amd64.deb`;
const RPM = `neuma-${V}-1.fc44.x86_64.rpm`;

const release = async ({ feedVersion = V, feedBytes = null, signed = true, sumsFor = null } = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'publish-site-'));
  const files = { [APP]: Buffer.from('appimage bytes '.repeat(500)), [DEB]: Buffer.from('deb bytes'), [RPM]: Buffer.from('rpm bytes') };
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(dir, name), bytes);
  const app = feedBytes ?? files[APP];
  await writeFile(join(dir, 'latest-linux.yml'), yaml.dump({
    version: feedVersion,
    files: [{ url: APP, sha512: createHash('sha512').update(app).digest('base64'), size: app.length }],
    path: APP,
  }));
  const sums = Object.entries(sumsFor ?? files).map(([n, b]) => `${createHash('sha256').update(b).digest('hex')}  ${n}`).join('\n');
  await writeFile(join(dir, 'SHA256SUMS'), `${sums}\n`);
  if (signed) await writeFile(join(dir, 'SHA256SUMS.asc'), '-----BEGIN PGP SIGNATURE-----\n');
  return dir;
};

describe('the release check', () => {
  it('a true release passes, and the feed uploads LAST', async () => {
    const { uploads, problems } = await checkRelease({ dir: await release(), version: V });
    expect(problems).toEqual([]);
    const order = uploads.map((u) => u.name);
    expect(new Set(order.slice(0, 3))).toEqual(new Set([APP, DEB, RPM])); // every installer first
    expect(order.slice(3)).toEqual(['SHA256SUMS', 'SHA256SUMS.asc', 'latest-linux.yml']); // the feed last
  });

  it('a feed whose sha512 disagrees with the installer is refused', async () => {
    const { problems } = await checkRelease({ dir: await release({ feedBytes: Buffer.from('other bytes') }), version: V });
    expect(problems.join('\n')).toMatch(/sha512 disagrees/);
    expect(problems.join('\n')).toMatch(/size disagrees/);
  });

  it('a feed for another version is refused', async () => {
    const { problems } = await checkRelease({ dir: await release({ feedVersion: '0.1.29' }), version: V });
    expect(problems.join('\n')).toMatch(/names version 0.1.29/);
  });

  it('checksums that do not vouch for an installer are refused', async () => {
    const dir = await release({ sumsFor: { [APP]: Buffer.from('not the appimage') } });
    const { problems } = await checkRelease({ dir, version: V });
    expect(problems.join('\n')).toMatch(new RegExp(`does not vouch for ${APP.replace(/\./g, '\\.')}`));
  });

  it('an unsigned release is refused unless it is a rehearsal', async () => {
    const dir = await release({ signed: false });
    expect((await checkRelease({ dir, version: V })).problems.join('\n')).toMatch(/unsigned/);
    expect((await checkRelease({ dir, version: V, allowUnsigned: true })).problems).toEqual([]);
  });

  it('stores each file as the site serves it', () => {
    expect(contentTypeOf('latest-linux.yml')).toBe('text/yaml; charset=utf-8');
    expect(contentTypeOf('SHA256SUMS.asc')).toBe('text/plain; charset=utf-8');
    expect(contentTypeOf(APP)).toBe('application/octet-stream');
  });
});
