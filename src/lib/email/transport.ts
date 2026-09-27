import 'server-only';

import { getServerEnv } from '@/lib/env';
import { createLogger } from '@/lib/log';
import { sanitizeHeaderValue, type RenderedEmail } from './render';

const logger = createLogger({ component: 'email' });

/**
 * Resend transport over its documented HTTP API.
 *
 * Called directly rather than through the SDK for one specific reason: we must
 * control the `Idempotency-Key` header ourselves. The dangerous failure mode for
 * email is a timeout AFTER Resend accepted the message - a naive retry would
 * double-send. The delivery row id is the idempotency key, so a retry of an
 * already-accepted message is collapsed by Resend instead of delivered twice.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
  retryable: boolean;
  status: number | null;
}

export interface SendInput {
  to: string;
  email: RenderedEmail;
  /** Stable across retries of the same logical message. */
  idempotencyKey: string;
}

export function isEmailConfigured(): boolean {
  try {
    const env = getServerEnv();
    return Boolean(env.resendApiKey && env.resendFrom);
  } catch {
    return false;
  }
}

/** Conservative address check; also blocks header-injection attempts. */
export function isValidRecipient(value: string): boolean {
  if (!value || value.length > 254) return false;
  if (/[\r\n,;<>]/.test(value)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function sendEmail(
  input: SendInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const env = getServerEnv();

  if (!env.resendApiKey || !env.resendFrom) {
    return {
      ok: false,
      messageId: null,
      error: 'Resend is not configured (RESEND_API_KEY / RESEND_FROM).',
      retryable: false,
      status: null,
    };
  }
  if (!isValidRecipient(input.to)) {
    return {
      ok: false,
      messageId: null,
      error: 'Invalid recipient address.',
      retryable: false,
      status: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from: env.resendFrom,
        to: [input.to],
        subject: sanitizeHeaderValue(input.email.subject),
        html: input.email.html,
        text: input.email.text,
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let body: unknown = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const message =
        (body && typeof body === 'object' && 'message' in body
          ? String((body as { message: unknown }).message)
          : null) ?? `Resend returned HTTP ${response.status}`;
      return {
        ok: false,
        messageId: null,
        error: message.slice(0, 400),
        // 4xx is our fault and will not fix itself; 429/5xx is worth retrying.
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
      };
    }

    const messageId =
      body && typeof body === 'object' && 'id' in body
        ? String((body as { id: unknown }).id)
        : null;
    return { ok: true, messageId, error: null, retryable: false, status: response.status };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    logger.error('email transport failure', {
      aborted,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      messageId: null,
      // A timeout may mean "accepted but slow to answer"; the idempotency key
      // makes retrying safe.
      error: aborted ? 'Resend request timed out' : 'Resend network failure',
      retryable: true,
      status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
