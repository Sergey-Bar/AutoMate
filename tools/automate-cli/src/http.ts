import { CliError, EXIT } from './errors.js';
import type { Target } from './target.js';

/**
 * One request to the install, and the one place a response becomes an exit code.
 *
 * The token travels only in the `Authorization` header to `target.origin`; the request is
 * never redirected (`redirect: 'error'`), so a 3xx from a proxy cannot carry it elsewhere.
 * A refusal prints the server's own `error.message` and stable `error.code`, never the token.
 */
export interface SendOptions {
  method: 'GET' | 'POST' | 'PUT';
  body?: Uint8Array<ArrayBuffer> | string;
  contentType?: string;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

function refusalText(status: number, body: unknown): string {
  const error = (body as ErrorBody | null)?.error;
  const code = typeof error?.code === 'string' ? `${error.code}: ` : '';
  const message = typeof error?.message === 'string' ? error.message : `HTTP ${String(status)}`;
  return `${code}${message}`;
}

async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function send(
  fetchImpl: typeof fetch,
  target: Target,
  url: URL,
  options: SendOptions,
): Promise<unknown> {
  if (url.origin !== target.origin.origin) {
    throw new CliError(`Refusing to send the token to ${url.origin}`, EXIT.usage);
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${target.token}`,
        accept: 'application/json',
        // An install behind Cloudflare Access: the service token gets the request through
        // Access, to this origin only, like the access token beside it.
        ...(target.cloudflareAccess === undefined
          ? {}
          : {
              'cf-access-client-id': target.cloudflareAccess.clientId,
              'cf-access-client-secret': target.cloudflareAccess.clientSecret,
            }),
        ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }),
      },
      ...(options.body === undefined ? {} : { body: options.body }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not reach ${target.origin.origin}: ${reason}`, EXIT.refused);
  }
  const body = await bodyOf(response);
  if (response.status === 401 || response.status === 403) {
    throw new CliError(`Refused: ${refusalText(response.status, body)}`, EXIT.unauthorised);
  }
  if (!response.ok) {
    throw new CliError(`Refused: ${refusalText(response.status, body)}`, EXIT.refused);
  }
  return body;
}
