/**
 * webhooks.ts — Generic webhook dispatcher with retry logic
 */

import { assertExternalUrlWithDNS } from '../../utils/url-validation.js';
import { readConfig } from './config.js';

/**
 * Dispatch a webhook with retry logic (up to 3 retries with exponential backoff)
 */
export async function dispatchWebhook(
  url: string,
  event: string,
  payload: object,
): Promise<void> {
  const body = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
  });

  const delays = [1000, 2000, 4000]; // 1s, 2s, 4s

  // SSRF check: validate URL + DNS resolution before every dispatch.
  // This prevents DNS rebinding attacks where a hostname changes to a private IP
  // after the webhook was initially registered.
  await assertExternalUrlWithDNS(url);

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      });

      if (res.ok) return; // Success
      if (res.status >= 400 && res.status < 500) {
        // Client error — don't retry
        throw new Error(`Webhook failed with status ${res.status}`);
      }
    } catch (err) {
      if (attempt === 2) throw err; // Last attempt
    }

    // Wait before retry
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/**
 * Dispatch to all webhooks configured for a given event
 */
export async function dispatchAllWebhooks(event: string, payload: object): Promise<void> {
  const config = readConfig();

  const webhooks = config.webhooks ?? [];
  const matching = webhooks.filter((wh) => wh.events.includes(event));

  // Fire all webhooks in parallel
  await Promise.allSettled(
    matching.map((wh) => dispatchWebhook(wh.url, event, payload)),
  );
}
