import './load-env';

/**
 * Generates a VAPID key pair for Web Push.
 *
 * The public key is safe in the browser (it is how the push service identifies
 * this application); the private key signs push requests and must stay on the
 * server. Rotating the pair invalidates every existing subscription, so do it
 * once and keep it.
 *
 *   npm run gen:vapid
 */

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('Add these to .env.local and to your deployment environment:\n');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:you@yourdomain.com`);
console.log('\nRotating these invalidates every existing push subscription.');
