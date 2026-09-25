/**
 * Validate that a URL is a safe external HTTP(S) endpoint.
 * Blocks private / loopback / link-local IPs (SSRF prevention).
 */
import { lookup as dnsLookup } from 'dns/promises';

/**
 * Check whether an IPv4 address falls within a private/reserved range.
 * Returns a reason string if blocked, or null if the address is public.
 */
function checkPrivateIPv4(ip: string): string | null {
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!ipv4Match) return null;
  const [, aStr, bStr] = ipv4Match;
  const a = Number(aStr ?? 0);
  const b = Number(bStr ?? 0);
  if (
    a === 127 ||                       // 127.0.0.0/8
    a === 10 ||                        // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||        // 192.168.0.0/16
    (a === 169 && b === 254) ||        // 169.254.0.0/16 (link-local)
    a === 0                            // 0.0.0.0/8
  ) {
    return 'Private/internal IP addresses are not allowed';
  }
  return null;
}

/**
 * Check whether an IPv6 address is loopback or link-local.
 */
function checkPrivateIPv6(ip: string): string | null {
  // Strip surrounding brackets from IPv6 literals (e.g. [::1])
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');

  // Loopback ::1
  if (normalized === '::1') {
    return 'Localhost URLs are not allowed';
  }

  // Unspecified address ::
  if (normalized === '::') {
    return 'Unspecified IPv6 address is not allowed';
  }

  // Link-local fe80::/10 (fe80:: through febf::)
  if (/^fe[89ab][0-9a-f]:/.test(normalized) || normalized === 'fe80' || normalized.startsWith('fe80::')) {
    return 'Link-local IPv6 addresses are not allowed';
  }

  // ULA fc00::/7 (fc00:: through fdff::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return 'Private IPv6 (ULA) addresses are not allowed';
  }

  return null;
}

export function assertExternalUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1'
  ) {
    throw new Error('Localhost URLs are not allowed');
  }

  // Block private / reserved IPv4 ranges (literal IP in URL)
  const ipv4Block = checkPrivateIPv4(hostname);
  if (ipv4Block) {
    throw new Error(ipv4Block);
  }

  // Block private IPv6 (literal IP in URL)
  const ipv6Block = checkPrivateIPv6(hostname);
  if (ipv6Block) {
    throw new Error(ipv6Block);
  }

  return parsed;
}

/**
 * Full SSRF-safe URL validation: parse + DNS resolution check.
 * After parsing the URL, resolves the hostname and verifies the
 * resolved IP is not in a private/reserved range (DNS rebinding protection).
 */
export async function assertExternalUrlWithDNS(raw: string): Promise<URL> {
  const parsed = assertExternalUrl(raw);

  // If hostname is already an IP literal, we already checked it above
  const hostname = parsed.hostname.toLowerCase();
  const isIPv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  const isIPv6 = hostname.startsWith('[') || hostname.includes(':');
  if (isIPv4 || isIPv6) {
    return parsed;
  }

  // DNS resolution check — verify ALL resolved addresses are not in private ranges.
  // Using { all: true } prevents bypass via multi-A/AAAA records where one is public.
  try {
    const addresses = await dnsLookup(hostname, { all: true });
    for (const { address, family } of addresses) {
      if (family === 4) {
        const block = checkPrivateIPv4(address);
        if (block) {
          throw new Error(`DNS resolution for "${hostname}" returned a private IP (${address})`);
        }
      } else if (family === 6) {
        const block = checkPrivateIPv6(address);
        if (block) {
          throw new Error(`DNS resolution for "${hostname}" returned a private IPv6 (${address})`);
        }
      }
    }
  } catch (err) {
    // Re-throw our own errors (private IP detected)
    if (err instanceof Error && err.message.includes('DNS resolution')) {
      throw err;
    }
    // DNS lookup failures — block the request (fail-closed)
    throw new Error(`DNS resolution failed for "${hostname}": ${(err as Error).message}`);
  }

  return parsed;
}
