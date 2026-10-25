import { isIP } from 'node:net';

/**
 * Address ranges, and the two questions the LAN server asks of them: is this bind
 * address reachable from another machine, and is this client allowed in.
 *
 * Dependency-free on purpose. It is twelve lines of bit arithmetic, and a package for
 * it would be a supply-chain entry in front of the one check that decides who may
 * reach the install.
 */

/** The ranges a LAN install admits when `ALLOWED_CLIENT_CIDRS` is unset. */
export const DEFAULT_CLIENT_CIDRS: readonly string[] = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

interface Range {
  family: 4 | 6;
  base: bigint;
  bits: number;
}

function toBigInt(address: string, family: 4 | 6): bigint {
  if (family === 4) {
    return address.split('.').reduce((total, octet) => (total << 8n) + BigInt(Number(octet)), 0n);
  }
  // Expand `::` to the zero groups it stands for, then read eight 16-bit groups.
  const [head = '', tail = ''] = address.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = address.includes('::') ? (tail === '' ? [] : tail.split(':')) : [];
  const groups = address.includes('::')
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return groups.reduce((total, group) => (total << 16n) + BigInt(Number.parseInt(group, 16)), 0n);
}

/** An IPv4-mapped IPv6 address (`::ffff:192.168.1.5`) is the IPv4 address it maps. */
function unmap(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address);
  return mapped?.[1] ?? address;
}

/**
 * One `a.b.c.d/n` or `x::/n` range.
 *
 * @throws {Error} naming the range, for a bad address or a prefix out of bounds
 */
export function parseCidr(cidr: string): Range {
  const [address = '', prefix] = cidr.trim().split('/');
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error(`"${cidr}" is not an IP range`);
  const max = family === 4 ? 32 : 128;
  const bits = prefix === undefined ? max : Number(prefix);
  if (!Number.isInteger(bits) || bits < 0 || bits > max) {
    throw new Error(`"${cidr}" has a prefix outside 0-${String(max)}`);
  }
  return { family, base: toBigInt(address, family), bits };
}

function contains(range: Range, address: string): boolean {
  const plain = unmap(address);
  const family = isIP(plain);
  if (family !== range.family) return false;
  const width = BigInt(family === 4 ? 32 : 128);
  const shift = width - BigInt(range.bits);
  return toBigInt(plain, family) >> shift === range.base >> shift;
}

/** Whether `address` falls inside any of `cidrs`. A string that is not an address is outside. */
export function isAddressAllowed(address: string, cidrs: readonly string[]): boolean {
  return cidrs.some((cidr) => contains(parseCidr(cidr), address.replace(/^\[|\]$/gu, '')));
}

/** Whether a bind address keeps the install on this machine. */
export function isLoopbackBind(bind: string): boolean {
  const host = bind
    .trim()
    .replace(/^\[|\]$/gu, '')
    .toLowerCase();
  if (host === 'localhost') return true;
  if (isIP(unmap(host)) === 0) return false;
  return isAddressAllowed(host, ['127.0.0.0/8', '::1/128']);
}
