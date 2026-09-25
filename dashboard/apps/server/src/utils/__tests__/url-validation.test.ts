import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertExternalUrl, assertExternalUrlWithDNS } from '../url-validation.js';

// Mock dns/promises to control DNS resolution in tests
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup as dnsLookup } from 'dns/promises';
const mockDnsLookup = vi.mocked(dnsLookup);

describe('assertExternalUrl', () => {
  it('returns URL object for valid HTTP URL', () => {
    const parsed = assertExternalUrl('http://example.com');
    expect(parsed).toBeInstanceOf(URL);
    expect(parsed.href).toBe('http://example.com/');
  });

  it('returns URL object for valid HTTPS URL', () => {
    const parsed = assertExternalUrl('https://example.com/resource');
    expect(parsed).toBeInstanceOf(URL);
    expect(parsed.href).toBe('https://example.com/resource');
  });

  it('rejects FTP URLs', () => {
    expect(() => assertExternalUrl('ftp://example.com/file.txt')).toThrowError(
      'Only http and https URLs are allowed',
    );
  });

  it('rejects file:// URLs', () => {
    expect(() => assertExternalUrl('file:///etc/passwd')).toThrowError('Only http and https URLs are allowed');
  });

  it('rejects javascript: URLs', () => {
    expect(() => assertExternalUrl('javascript:alert(1)')).toThrowError('Only http and https URLs are allowed');
  });

  it('rejects malformed URLs', () => {
    expect(() => assertExternalUrl('not a url')).toThrowError('Invalid URL');
  });

  it('rejects localhost hostname', () => {
    expect(() => assertExternalUrl('http://localhost')).toThrowError('Localhost URLs are not allowed');
  });

  it('rejects localhost IPv6 bracket form', () => {
    expect(() => assertExternalUrl('http://[::1]')).toThrowError('Localhost URLs are not allowed');
  });

  it('rejects localhost IPv6 bare form', () => {
    expect(() => assertExternalUrl('::1')).toThrowError('Invalid URL');
  });

  it('rejects 127.0.0.1 loopback', () => {
    expect(() => assertExternalUrl('http://127.0.0.1')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('rejects entire 127.0.0.0/8 range', () => {
    expect(() => assertExternalUrl('http://127.0.0.254')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('rejects 10.0.0.0/8 range', () => {
    expect(() => assertExternalUrl('http://10.0.0.1')).toThrowError('Private/internal IP addresses are not allowed');
  });

  it('rejects 172.16.0.0/12 lower bound', () => {
    expect(() => assertExternalUrl('http://172.16.0.1')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('rejects 172.16.0.0/12 upper bound', () => {
    expect(() => assertExternalUrl('http://172.31.255.255')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('allows 172.15.x.x outside private /12', () => {
    const parsed = assertExternalUrl('http://172.15.0.1');
    expect(parsed.href).toBe('http://172.15.0.1/');
  });

  it('allows 172.32.x.x outside private /12', () => {
    const parsed = assertExternalUrl('http://172.32.0.1');
    expect(parsed.href).toBe('http://172.32.0.1/');
  });

  it('rejects 192.168.0.0/16 range', () => {
    expect(() => assertExternalUrl('http://192.168.1.1')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('rejects 169.254.0.0/16 link-local range', () => {
    expect(() => assertExternalUrl('http://169.254.1.1')).toThrowError(
      'Private/internal IP addresses are not allowed',
    );
  });

  it('rejects 0.0.0.0/8 range', () => {
    expect(() => assertExternalUrl('http://0.0.0.0')).toThrowError('Private/internal IP addresses are not allowed');
  });

  it('allows public 8.8.8.8 IP', () => {
    const parsed = assertExternalUrl('http://8.8.8.8');
    expect(parsed.href).toBe('http://8.8.8.8/');
  });

  it('allows public 1.1.1.1 IP', () => {
    const parsed = assertExternalUrl('https://1.1.1.1');
    expect(parsed.href).toBe('https://1.1.1.1/');
  });

  it('allows URL with explicit port', () => {
    const parsed = assertExternalUrl('https://example.com:8443/path');
    expect(parsed.port).toBe('8443');
    expect(parsed.pathname).toBe('/path');
  });

  it('allows URL with path and query parameters', () => {
    const parsed = assertExternalUrl('https://example.com/api/v1/items?limit=10&sort=desc');
    expect(parsed.pathname).toBe('/api/v1/items');
    expect(parsed.search).toBe('?limit=10&sort=desc');
  });

  it('preserves authentication information in parsed URL when provided', () => {
    const parsed = assertExternalUrl('https://user:pass@example.com/private');
    expect(parsed.username).toBe('user');
    expect(parsed.password).toBe('pass');
    expect(parsed.hostname).toBe('example.com');
  });

  it('allows domains containing localhost as a subdomain', () => {
    const parsed = assertExternalUrl('https://localhost.evil.com/path');
    expect(parsed.hostname).toBe('localhost.evil.com');
    expect(parsed.pathname).toBe('/path');
  });

  it('rejects private ULA IPv6 fc00::/7 range', () => {
    expect(() => assertExternalUrl('http://[fc00::1]')).toThrowError(
      'Private IPv6 (ULA) addresses are not allowed',
    );
  });

  it('rejects private ULA IPv6 fd prefix', () => {
    expect(() => assertExternalUrl('http://[fd12:3456:789a:1::1]')).toThrowError(
      'Private IPv6 (ULA) addresses are not allowed',
    );
  });
});

describe('assertExternalUrlWithDNS', () => {
  afterEach(() => {
    mockDnsLookup.mockReset();
  });

  it('returns URL for public hostname resolving to public IPv4', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const parsed = await assertExternalUrlWithDNS('https://example.com');
    expect(parsed).toBeInstanceOf(URL);
    expect(parsed.hostname).toBe('example.com');
    expect(mockDnsLookup).toHaveBeenCalledWith('example.com', { all: true });
  });

  it('blocks hostname resolving to private IPv4 (10.x)', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
    await expect(assertExternalUrlWithDNS('https://evil.com')).rejects.toThrowError(
      /DNS resolution for "evil\.com" returned a private IP/,
    );
  });

  it('blocks hostname resolving to loopback 127.x', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(assertExternalUrlWithDNS('https://evil.com')).rejects.toThrowError(
      /DNS resolution for "evil\.com" returned a private IP/,
    );
  });

  it('blocks hostname resolving to 192.168.x.x', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    await expect(assertExternalUrlWithDNS('https://evil.com')).rejects.toThrowError(
      /DNS resolution for "evil\.com" returned a private IP/,
    );
  });

  it('blocks when ANY resolved address is private (mixed public + private)', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(assertExternalUrlWithDNS('https://evil.com')).rejects.toThrowError(
      /DNS resolution for "evil\.com" returned a private IP/,
    );
  });

  it('blocks hostname resolving to private IPv6 ULA (fd00::)', async () => {
    mockDnsLookup.mockResolvedValue([{ address: 'fd12::1', family: 6 }] as never);
    await expect(assertExternalUrlWithDNS('https://evil.com')).rejects.toThrowError(
      /DNS resolution for "evil\.com" returned a private IPv6/,
    );
  });

  it('blocks hostname resolving to IPv6 loopback ::1', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '::1', family: 6 }] as never);
    await expect(assertExternalUrlWithDNS('https://evil.com')).rejects.toThrowError(
      /DNS resolution for "evil\.com" returned a private IPv6/,
    );
  });

  it('blocks hostname resolving to link-local fe80::', async () => {
    mockDnsLookup.mockResolvedValue([{ address: 'fe80::1', family: 6 }] as never);
    await expect(assertExternalUrlWithDNS('https://evil.com')).rejects.toThrowError(
      /DNS resolution for "evil\.com" returned a private IPv6/,
    );
  });

  it('fails closed on DNS lookup failure', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertExternalUrlWithDNS('https://no-such-host.example')).rejects.toThrowError(
      /DNS resolution failed for "no-such-host\.example"/,
    );
  });

  it('skips DNS resolution for IPv4 literal addresses', async () => {
    const parsed = await assertExternalUrlWithDNS('https://8.8.8.8');
    expect(parsed.hostname).toBe('8.8.8.8');
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('skips DNS resolution for IPv6 literal addresses', async () => {
    await expect(assertExternalUrlWithDNS('http://[::1]')).rejects.toThrowError(
      'Localhost URLs are not allowed',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('allows multiple public resolved addresses', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ] as never);
    const parsed = await assertExternalUrlWithDNS('https://example.com');
    expect(parsed.hostname).toBe('example.com');
  });

  it('still validates URL structure before DNS (rejects ftp)', async () => {
    await expect(assertExternalUrlWithDNS('ftp://example.com')).rejects.toThrowError(
      'Only http and https URLs are allowed',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });
});
