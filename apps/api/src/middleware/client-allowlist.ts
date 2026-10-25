import type { Context, MiddlewareHandler } from 'hono';
import { isAddressAllowed } from '@automate/config';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

export interface ClientAllowlistOptions {
  /** `ALLOWED_CLIENT_CIDRS`, parsed. */
  cidrs: readonly string[];
  /** Off for a loopback install, where every peer is this machine. */
  enabled: boolean;
  /**
   * The client's address. `defaultClientKey` in production: the last `X-Forwarded-For` hop
   * when the proxy is trusted, otherwise the TCP peer — never a header the client chose.
   */
  clientKey: (context: Context) => string;
}

/**
 * Refuses a client outside the configured ranges, before any route runs.
 *
 * A second line behind sign-in, not a replacement for it: a LAN install's threat is the
 * guest Wi-Fi, a port forward someone added to the router, or a VPN that bridges more than
 * it should. The ranges default to the private, loopback and link-local blocks, so a home
 * or office network works with no configuration and a public address does not.
 *
 * `unknown-client` — an in-process request with no socket — is admitted, because there is
 * no peer to judge. A real server request always has a socket.
 */
export function createClientAllowlist(options: ClientAllowlistOptions): MiddlewareHandler {
  return async (context, next) => {
    if (options.enabled) {
      const client = options.clientKey(context);
      if (client !== 'unknown-client' && !isAddressAllowed(client, options.cidrs)) {
        throw new DomainError(
          ErrorCode.CLIENT_NOT_ALLOWED,
          'This address is not allowed to reach this install',
        );
      }
    }
    await next();
  };
}
