import {
  assertPublicTarget,
  isPrivateAddress,
  parseTargetUrl,
  UnresolvableTargetError,
  UnsafeTargetError,
} from './ssrf';

describe('SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('flags %s as non-public', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1',
    '172.32.0.1',
    '100.63.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('allows public address %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it.each([
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    'https://user:pw@example.com/',
  ])('rejects unsafe URL %p', (raw) => {
    expect(() => parseTargetUrl(raw)).toThrow(UnsafeTargetError);
  });

  it('rejects literal private IPs and the metadata endpoint without any DNS lookup', async () => {
    await expect(assertPublicTarget('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      UnsafeTargetError,
    );
    await expect(assertPublicTarget('http://127.0.0.1:8080/hook')).rejects.toThrow(UnsafeTargetError);
    await expect(assertPublicTarget('http://[::1]/hook')).rejects.toThrow(UnsafeTargetError);
  });

  it('accepts a literal public IP and honours the explicit dev override', async () => {
    await expect(assertPublicTarget('https://8.8.8.8/hook')).resolves.toBeInstanceOf(URL);
    await expect(assertPublicTarget('http://127.0.0.1:9/hook', true)).resolves.toBeInstanceOf(URL);
  });
});

describe('assertPublicTarget with a host that does not exist', () => {
  it('is a typed client error, not a crash (RFC 6761: .invalid never resolves)', async () => {
    await expect(assertPublicTarget('https://hooks.example.invalid/in')).rejects.toBeInstanceOf(
      UnresolvableTargetError,
    );
  });
});
