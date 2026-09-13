import { Inter, IBM_Plex_Mono } from 'next/font/google';

/**
 * Self-hosted at build time by next/font — no runtime CDN request, no layout
 * shift, and nothing for a content blocker to break.
 *
 * Inter carries the interface. IBM Plex Mono carries "ticket data": station
 * codes, train numbers, times and prices. The pairing reads as transit/ticketing
 * without dressing up as a departure board.
 */
export const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  axes: ['opsz'],
});

export const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
});
