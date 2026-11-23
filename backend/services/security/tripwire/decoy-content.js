// Decoy content — what a planted decoy file holds. Every byte is random at
// plant time: nothing here is, or ever was, a real key, wallet or credential.
// The shapes are the ones a stealer's parser expects, so a decoy is read like
// the real thing and tells nothing apart at a glance.
//
// Pure: each generator takes `rand(n) → Buffer` (crypto.randomBytes in
// production) and returns the file's bytes.

const WORDS = Object.freeze(('abandon ability able about absorb abstract absurd access accident account acid acoustic '
  + 'acquire across action actor adapt address adjust admit adult advance advice afford again agent agree ahead '
  + 'airport alarm album alcohol alert alien alley allow almost alone alpha already alter always amateur amazing '
  + 'among amount amused anchor ancient anger angle animal ankle announce annual another answer antenna antique '
  + 'anxiety apart apology appear apple approve april arch arctic area arena argue armor army around arrange').split(' '));

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const pickFrom = (alphabet, bytes) => [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
const hex = (rand, n) => rand(n).toString('hex');

/** Twelve words from the wordlist — never a valid checksum, by chance alone. */
const seedPhrase = (rand) => [...rand(12)].map((b) => WORDS[b % WORDS.length]).join(' ');

/** A Solana CLI keypair file: a JSON array of 64 byte values. */
export const solanaKeypair = (rand) => Buffer.from(JSON.stringify([...rand(64)]));

/** An Ethereum V3 keystore (scrypt) with random ciphertext. */
export const ethKeystore = (rand) => {
  const id = hex(rand, 16).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  return Buffer.from(JSON.stringify({
    address: hex(rand, 20),
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: hex(rand, 32),
      cipherparams: { iv: hex(rand, 16) },
      kdf: 'scrypt',
      kdfparams: { dklen: 32, n: 262144, p: 1, r: 8, salt: hex(rand, 32) },
      mac: hex(rand, 32),
    },
    id,
    version: 3,
  }));
};

/** The address an Ethereum keystore file name carries. */
export const ethKeystoreName = (rand, at) =>
  `UTC--${new Date(at).toISOString().replace(/:/g, '-')}--${hex(rand, 20)}`;

/** An Electrum standard wallet file, unencrypted on its face. */
export const electrumWallet = (rand) => Buffer.from(JSON.stringify({
  addr_history: {},
  keystore: {
    seed: seedPhrase(rand),
    type: 'bip32',
    xprv: `xprv${pickFrom(B58, rand(107))}`,
    xpub: `xpub${pickFrom(B58, rand(107))}`,
  },
  seed_type: 'segwit',
  seed_version: 18,
  use_encryption: false,
  wallet_type: 'standard',
}));

/** Exodus's encrypted seed container: opaque bytes behind its magic. */
export const exodusSeed = (rand) => Buffer.concat([Buffer.from('SECO\0\0\0\0'), rand(712)]);

/** Exodus's passphrase file. */
export const exodusPassphrase = (rand) => Buffer.from(JSON.stringify({ passphrase: rand(24).toString('base64') }));

/** A Bitcoin Core wallet.dat: Berkeley DB btree magic at byte 12, the rest opaque. */
export const bitcoinWallet = (rand) => {
  const body = rand(98304);
  body.writeUInt32LE(0x00053162, 12);
  return body;
};

/** An AWS shared-credentials file. The id is assembled here, never a literal. */
export const awsCredentials = (rand) => Buffer.from([
  '[default]',
  `aws_access_key_id = ${'AK'}${'IA'}${pickFrom(B32, rand(16))}`,
  `aws_secret_access_key = ${rand(30).toString('base64')}`,
  'region = us-east-1',
  '',
].join('\n'));
