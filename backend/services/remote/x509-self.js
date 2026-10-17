/**
 * x509-self — a minimal DER writer and self-signed X.509 v3 certificate
 * builder for EC P-256 keys, signed ECDSA-with-SHA256.
 *
 * Why hand-rolled: Node mints keys and signs, but cannot serialise a
 * certificate; and shelling out to `openssl` would put a platform binary on
 * the trust path of a packaged app. Nothing here is cryptography — the
 * signing itself is Node's own OpenSSL ECDSA. This file only arranges bytes
 * per ITU-T X.690 (DER) and RFC 5280. The proof is RULE 0's: every consumer
 * of these certificates completes a real TLS 1.3 handshake against Node's
 * own OpenSSL, which parses and verifies them or the handshake dies.
 *
 * The certificates are trust anchors for a pin-only world: the phone pins
 * the desk's SPKI by hash and never reads names; the desk trusts exactly the
 * device certificates listed in its store. CA:TRUE + keyCertSign keeps
 * OpenSSL's chain check content with a self-signed anchor; serverAuth +
 * clientAuth EKUs keep purpose checks happy on both legs.
 */
import crypto from 'node:crypto';

// --- DER primitives (X.690) ---

// DER demands MINIMAL length encoding: one length byte covers 0–127, two
// cover 128–255 (0x81 nn), three cover 256–65535 (0x82 nn nn). A certificate
// body is bounded well below the 0x81/0x82 frontier used here.
const derLength = (n) =>
  n < 0x80 ? Buffer.of(n)
    : n < 0x100 ? Buffer.from([0x81, n])
      : Buffer.from([0x82, n >> 8 & 0xff, n & 0xff]);

const tlv = (tag, body) => Buffer.concat([Buffer.of(tag), derLength(body.length), body]);

const derSequence = (...parts) => tlv(0x30, Buffer.concat(parts));
const derSet = (...parts) => tlv(0x31, Buffer.concat(parts));
const derOctetString = (body) => tlv(0x04, body);
const derBoolean = (value) => tlv(0x01, Buffer.of(value ? 0xff : 0x00));
const derInteger = (bytes) => tlv(0x02, bytes);
const derUtf8String = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
const derContext = (n, body) => tlv(0xa0 | n, body);

/** BIT STRING wrapping raw bytes, `unused` trailing bits of the last byte dead. */
const derBitString = (bytes, unused = 0) =>
  tlv(0x03, Buffer.concat([Buffer.of(unused), bytes]));

/**
 * DER OBJECT IDENTIFIER — first two arcs folded into 40·a+b, base-127 after.
 * @param {string} dotted
 * @returns {Buffer}
 */
const derOid = (dotted) => {
  const arcs = dotted.split('.').map(Number);
  const body = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    if (arc < 0x80) { body.push(arc); continue; }
    const chunk = [arc & 0x7f];
    let rest = Math.floor(arc / 128);
    while (rest > 0) { chunk.unshift((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); }
    body.push(...chunk);
  }
  return tlv(0x06, Buffer.of(...body));
};

const pad2 = (n) => String(n).padStart(2, '0');

/** UTCTime — valid 1950–2049, which outlives every TTL this desk mints. */
const derUtcTime = (date) => {
  const d = date.getUTCFullYear() % 100;
  const text = `${pad2(d)}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`
    + `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(text, 'ascii'));
};

// --- RFC 5280 constants ---

const OID_COMMON_NAME = '2.5.4.3';
const OID_ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_EXT_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const OID_EXT_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';
// keyUsage: digitalSignature (bit 0) | keyCertSign (bit 5) → 0b10000100, 2 unused bits.
const KEY_USAGE_DIGITAL_SIGNATURE_KEY_CERT_SIGN = Buffer.of(0x84);

const nameCN = (commonName) =>
  derSequence(derSet(derSequence(derOid(OID_COMMON_NAME), derUtf8String(commonName))));

/** Positive random serial: the top bit is cleared so no sign byte is needed. */
const derSerial = () => {
  const bytes = crypto.randomBytes(16);
  bytes[0] &= 0x7f;
  return derInteger(bytes[0] === 0 ? bytes.subarray(1) : bytes);
};

const pemCert = (der) =>
  `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;

/**
 * Build a self-signed v3 certificate for an EC P-256 key pair. impure
 * (randomness, and the signature itself).
 * @param {{ key: crypto.KeyObject, commonName: string, days?: number, now?: Date }} input
 *   `key` is the private KeyObject; `days` sets notAfter (30 = a device cert
 *   matching pairing.js's DEVICE_TTL_MS; 365+ = the desk identity).
 * @returns {string} PEM
 */
export const buildSelfSignedCert = ({ key, commonName, days = 30, now = new Date() }) => {
  // Backdate a minute: phones and desks disagree about "now".
  const notBefore = new Date(now.getTime() - 60 * 1000);
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const spki = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  // An AlgorithmIdentifier is a SEQUENCE wrapping the OID — a bare OID here
  // is the classic hand-rolled X.509 bug (the generic parser tolerates it;
  // the X.509 layer reads "wrong tag").
  const ecdsaSha256 = derSequence(derOid(OID_ECDSA_WITH_SHA256));
  const extensions = derSequence(
    derSequence(derOid(OID_BASIC_CONSTRAINTS), derOctetString(derSequence(derBoolean(true)))),
    derSequence(derOid(OID_KEY_USAGE), derBoolean(true),
      derOctetString(derBitString(KEY_USAGE_DIGITAL_SIGNATURE_KEY_CERT_SIGN, 2))),
    derSequence(derOid(OID_EXT_KEY_USAGE),
      derOctetString(derSequence(derOid(OID_EXT_SERVER_AUTH), derOid(OID_EXT_CLIENT_AUTH)))),
  );
  const tbsCertificate = derSequence(
    derContext(0, derInteger(Buffer.of(2))),
    derSerial(),
    ecdsaSha256,
    nameCN(commonName),
    derSequence(derUtcTime(notBefore), derUtcTime(notAfter)),
    nameCN(commonName),
    spki,
    derContext(3, extensions),
  );
  const signature = crypto.sign('sha256', tbsCertificate, { key, dsaEncoding: 'der' });
  return pemCert(derSequence(tbsCertificate, ecdsaSha256, derBitString(signature)));
};

/**
 * SHA-256 of a public key's SPKI DER — the device row's `spki`, the desk's
 * fingerprint source. Pure.
 * @param {crypto.KeyObject} publicKey
 * @returns {string} hex
 */
export const spkiSha256 = (publicKey) =>
  crypto.createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');

/**
 * The same hash, taken from a certificate's DER bytes — what a completed
 * handshake actually handed us. Pure.
 * @param {Buffer} certDer
 * @returns {string} hex
 */
export const spkiSha256OfCertDer = (certDer) =>
  spkiSha256(new crypto.X509Certificate(certDer).publicKey);
