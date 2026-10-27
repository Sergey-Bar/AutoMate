import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLIENT_CIDRS,
  isAddressAllowed,
  isLoopbackBind,
  isWildcardBind,
  parseCidr,
} from './network.js';

describe('isWildcardBind', () => {
  it('is every spelling of "all interfaces", and nothing else', () => {
    for (const bind of ['0.0.0.0', '::', '[::]', '0:0:0:0:0:0:0:0', ' 0.0.0.0 ', '::0']) {
      expect(isWildcardBind(bind), bind).toBe(true);
    }
    for (const bind of [
      '127.0.0.1',
      '::1',
      '192.168.1.5',
      'localhost',
      '0.0.0.1',
      'automate',
      '',
    ]) {
      expect(isWildcardBind(bind), bind).toBe(false);
    }
  });
});

describe('isAddressAllowed', () => {
  it('admits the private ranges a home or office network uses', () => {
    for (const address of ['192.168.1.20', '10.4.5.6', '172.20.0.3', '127.0.0.1', 'fd12::5']) {
      expect(isAddressAllowed(address, DEFAULT_CLIENT_CIDRS)).toBe(true);
    }
  });

  it('refuses a public address and the edges just outside a range', () => {
    for (const address of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '2001:db8::1']) {
      expect(isAddressAllowed(address, DEFAULT_CLIENT_CIDRS)).toBe(false);
    }
  });

  it('reads an IPv4-mapped IPv6 peer as the IPv4 address it maps', () => {
    expect(isAddressAllowed('::ffff:192.168.0.9', ['192.168.0.0/24'])).toBe(true);
    expect(isAddressAllowed('::ffff:8.8.8.8', ['192.168.0.0/24'])).toBe(false);
  });

  it('treats a non-address as outside every range', () => {
    expect(isAddressAllowed('unknown-client', DEFAULT_CLIENT_CIDRS)).toBe(false);
  });

  it('honours a /32 and a /0', () => {
    expect(isAddressAllowed('192.168.1.20', ['192.168.1.20/32'])).toBe(true);
    expect(isAddressAllowed('192.168.1.21', ['192.168.1.20/32'])).toBe(false);
    expect(isAddressAllowed('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
  });
});

describe('parseCidr', () => {
  it('reads a bare address as a single host, and IPv6 in every spelling', () => {
    expect(isAddressAllowed('192.168.1.20', ['192.168.1.20'])).toBe(true);
    expect(isAddressAllowed('192.168.1.21', ['192.168.1.20'])).toBe(false);
    // Fully written, `::` at the end, and `::` in the middle are the same address space.
    expect(isAddressAllowed('fd00:0:0:0:0:0:0:1', ['fd00::/8'])).toBe(true);
    expect(isAddressAllowed('fd00::', ['fd00:0:0:0:0:0:0:0/128'])).toBe(true);
    expect(isAddressAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
  });

  it('refuses a malformed range rather than admitting everything', () => {
    expect(() => parseCidr('10.0.0.0/33')).toThrow(/prefix/);
    expect(() => parseCidr('not-an-ip/8')).toThrow(/not an IP range/);
  });
});

describe('isLoopbackBind', () => {
  it('separates this-machine-only from reachable', () => {
    expect(isLoopbackBind('127.0.0.1')).toBe(true);
    expect(isLoopbackBind('localhost')).toBe(true);
    expect(isLoopbackBind('[::1]')).toBe(true);
    expect(isLoopbackBind('0.0.0.0')).toBe(false);
    expect(isLoopbackBind('192.168.1.10')).toBe(false);
    expect(isLoopbackBind('automate.local')).toBe(false);
  });
});
