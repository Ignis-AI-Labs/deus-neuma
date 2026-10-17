// The x509-self builder is structure, not cryptography — so the proof is
// that Node's own OpenSSL parses and verifies what it produces, end of
// story. Every assertion below runs against the real X509Certificate
// parser; the TLS integration test (remote-tunnel-boundary) goes further
// and completes a real handshake with these certificates.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSelfSignedCert, spkiSha256, spkiSha256OfCertDer } from '../../backend/services/remote/x509-self.js';

const keyPair = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

describe('buildSelfSignedCert', () => {
  it('produces a certificate OpenSSL parses, with the right key and name', () => {
    const { privateKey, publicKey } = keyPair();
    const pem = buildSelfSignedCert({ key: privateKey, commonName: 'Neuma Desk abc', days: 30 });
    const cert = new crypto.X509Certificate(pem);
    expect(cert.subject.split('=').pop()).toBe('Neuma Desk abc');
    expect(cert.issuer).toBe(cert.subject);
    expect(cert.publicKey.export({ type: 'spki', format: 'der' }))
      .toEqual(publicKey.export({ type: 'spki', format: 'der' }));
    expect(cert.ca).toBe(true);
  });

  it('the certificate verifies against its own public key', () => {
    const { privateKey } = keyPair();
    const cert = new crypto.X509Certificate(buildSelfSignedCert({ key: privateKey, commonName: 'CN', days: 30 }));
    expect(cert.verify(cert.publicKey)).toBe(true);
  });

  it('a signature from another key does not verify', () => {
    const signer = keyPair().privateKey;
    const other = keyPair();
    const cert = new crypto.X509Certificate(buildSelfSignedCert({ key: signer, commonName: 'CN', days: 30 }));
    expect(cert.verify(other.publicKey)).toBe(false);
  });

  it('validity honours the requested days, backdated one minute for clock skew', () => {
    const { privateKey } = keyPair();
    const now = new Date('2026-09-13T00:00:00Z');
    const cert = new crypto.X509Certificate(buildSelfSignedCert({ key: privateKey, commonName: 'CN', days: 30, now }));
    expect(new Date(cert.validFrom).getTime()).toBe(now.getTime() - 60 * 1000);
    expect(new Date(cert.validTo).getTime()).toBe(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  });
});

describe('spkiSha256', () => {
  it('hashes the public key, and agrees with the certificate DER form', () => {
    const { privateKey, publicKey } = keyPair();
    const pem = buildSelfSignedCert({ key: privateKey, commonName: 'CN', days: 30 });
    const der = new crypto.X509Certificate(pem).raw;
    expect(spkiSha256(publicKey)).toBe(spkiSha256OfCertDer(der));
    // A different key hashes differently.
    expect(spkiSha256(keyPair().publicKey)).not.toBe(spkiSha256(publicKey));
  });
});
