import type { Metadata, Viewport } from 'next';
import { AppClient } from '@/components/AppClient';
import { mono, sans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'RailDrop — Know when your train gets cheaper',
    template: '%s · RailDrop',
  },
  description:
    'RailDrop watches Amtrak fares after you have already bought a ticket, and tells you when a materially cheaper option appears on your route.',
  applicationName: 'RailDrop',
  robots: { index: true, follow: true },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'RailDrop', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'RailDrop',
    title: 'RailDrop — Know when your train gets cheaper',
    description:
      'Watches Amtrak fares after you have already bought a ticket, and tells you when a materially cheaper option appears.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf8' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0d0c' },
  ],
};

/**
 * Applies the saved theme before first paint. Without this the page flashes the
 * system theme for a frame before React hydrates. Static string, no interpolation.
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('rd-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-invert focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-invert"
        >
          Skip to content
        </a>
        <AppClient>{children}</AppClient>
      </body>
    </html>
  );
}
