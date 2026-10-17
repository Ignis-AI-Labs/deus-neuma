// impure: resolve only public resolver/trust files, never bind host /etc wholesale.
import fs from 'fs/promises';

const RESOLVERS = Object.freeze(['/etc/resolv.conf', '/etc/nsswitch.conf', '/etc/hosts']);
const CA_BUNDLES = Object.freeze([
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/ssl/cert.pem',
  '/etc/ssl/ca-bundle.pem',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/pki/tls/cert.pem',
  '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
]);

/** Dereference resolver/CA symlinks onto their standard guest file paths.
 * No private-key directories, client certs, credentials, or TLS bypass. impure. */
export const shellNetworkResources = async () => {
  const args = [];
  for (const destination of [...RESOLVERS, ...CA_BUNDLES]) {
    let source;
    try { source = await fs.realpath(destination); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!(await fs.stat(source)).isFile()) throw new Error(`Not a public resolver/trust file: ${destination}`);
    args.push('--ro-bind', source, destination);
  }
  return args;
};
