/**
 * Sends ONE real "RailDrop is ready" email and reports whether Resend accepted it.
 *
 *   npm run email:test -- you@example.com
 */

import './load-env';
import { renderReadyEmail } from '../src/lib/email/render';
import { isEmailConfigured, sendEmail } from '../src/lib/email/transport';
import { publicEnv } from '../src/lib/env';

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: npm run email:test -- you@example.com');
    process.exit(1);
  }
  if (!isEmailConfigured()) {
    console.error('Resend is not configured. Set RESEND_API_KEY and RESEND_FROM.');
    process.exit(1);
  }

  console.log(`Sending "RailDrop is ready" to ${to} ...`);

  const result = await sendEmail({
    to,
    email: renderReadyEmail(publicEnv.appUrl),
    idempotencyKey: `raildrop-ready-${Date.now()}`,
  });

  if (result.ok) {
    console.log(`EMAIL LIVE VERIFIED — Resend accepted the message.`);
    console.log(`  message id: ${result.messageId ?? '(not returned)'}`);
    process.exit(0);
  }

  console.error(`EMAIL FAILED — ${result.error}`);
  console.error(`  http status: ${result.status ?? 'n/a'}`);
  console.error(`  retryable:   ${result.retryable}`);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
