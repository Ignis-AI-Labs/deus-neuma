// Unit tests for the custom-RPC URL validator. This guards a main-process
// provider that BROADCASTS the witness's transactions, so the SSRF cases matter.

const { validateRpcUrl, embeddedV4 } = require('../../electron/wallet/rpc-url.cjs');

describe('validateRpcUrl', () => {
  it('accepts public https RPCs, including an Alchemy key path', () => {
    expect(validateRpcUrl('https://mainnet.base.org').ok).toBe(true);
    expect(validateRpcUrl('https://base-mainnet.g.alchemy.com/v2/SOME_KEY').ok).toBe(true);
  });

  it('accepts a local node (the user may run their own)', () => {
    expect(validateRpcUrl('http://localhost:8545').ok).toBe(true);
    expect(validateRpcUrl('http://127.0.0.1:8545').ok).toBe(true);
    expect(validateRpcUrl('http://[::1]:8545').ok).toBe(true);
  });

  it('rejects empty, non-URL, and non-http(s) schemes', () => {
    expect(validateRpcUrl('').ok).toBe(false);
    expect(validateRpcUrl('   ').ok).toBe(false);
    expect(validateRpcUrl('not a url').ok).toBe(false);
    expect(validateRpcUrl('ftp://example.com').ok).toBe(false);
    expect(validateRpcUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateRpcUrl('file:///etc/passwd').ok).toBe(false);
  });

  it('blocks SSRF to private, cloud-metadata, and link-local addresses', () => {
    expect(validateRpcUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false); // cloud metadata
    expect(validateRpcUrl('http://10.0.0.1:8545').ok).toBe(false);
    expect(validateRpcUrl('http://192.168.1.10:8545').ok).toBe(false);
    expect(validateRpcUrl('http://172.16.0.1:8545').ok).toBe(false);
    expect(validateRpcUrl('http://172.31.255.255').ok).toBe(false);
    expect(validateRpcUrl('http://0.0.0.0').ok).toBe(false);
    expect(validateRpcUrl('http://[fc00::1]').ok).toBe(false); // IPv6 unique-local
    expect(validateRpcUrl('http://[fe80::1]').ok).toBe(false); // IPv6 link-local
  });

  it('blocks IPv4-mapped IPv6 and alternate IP encodings of blocked ranges', () => {
    expect(validateRpcUrl('http://[::ffff:169.254.169.254]').ok).toBe(false); // mapped metadata
    expect(validateRpcUrl('http://[::ffff:10.0.0.1]').ok).toBe(false);        // mapped private
    expect(validateRpcUrl('http://2852039166/').ok).toBe(false);             // decimal 169.254.169.254
    expect(validateRpcUrl('http://0xa9fea9fe/').ok).toBe(false);             // hex
    expect(validateRpcUrl('http://0251.0376.0251.0376/').ok).toBe(false);    // octal
  });

  it('still allows a public IPv6', () => {
    expect(validateRpcUrl('http://[2606:4700::1111]').ok).toBe(true);
  });

  it('allows public addresses just outside the 172.16/12 private block', () => {
    expect(validateRpcUrl('http://172.15.0.1').ok).toBe(true);
    expect(validateRpcUrl('http://172.32.0.1').ok).toBe(true);
    expect(validateRpcUrl('https://1.2.3.4').ok).toBe(true);
  });

  it('returns the trimmed URL on success', () => {
    expect(validateRpcUrl('  https://mainnet.base.org  ')).toEqual({ ok: true, url: 'https://mainnet.base.org' });
  });
});

describe('embeddedV4 (IPv4-mapped IPv6 extraction)', () => {
  // Pins Node's WHATWG URL behaviour: a mapped address serializes to the HEX
  // form, so the hex branch is the live path for URL input. If a Node upgrade
  // ever changed this, this assertion (and the SSRF tests above) would fail.
  it('Node emits the hex form for an IPv4-mapped host', () => {
    expect(new URL('http://[::ffff:169.254.169.254]/').hostname).toBe('[::ffff:a9fe:a9fe]');
  });

  it('extracts the embedded v4 from the hex form (the live URL path)', () => {
    expect(embeddedV4('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    expect(embeddedV4('::ffff:a00:1')).toBe('10.0.0.1');
  });

  it('extracts the embedded v4 from the dotted form (defense-in-depth path)', () => {
    expect(embeddedV4('::ffff:169.254.169.254')).toBe('169.254.169.254');
    expect(embeddedV4('::10.0.0.1')).toBe('10.0.0.1');
  });

  it('returns null for a non-mapped IPv6 address', () => {
    expect(embeddedV4('2606:4700::1111')).toBe(null);
    expect(embeddedV4('::1')).toBe(null);
  });
});
