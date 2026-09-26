import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { LocalModeBanner } from "@/components/local-mode-banner";
import { appOrigin } from "@/lib/config";
import "./globals.css";
import { EmbedAnnounce } from "@/components/embed-announce";

// Two faces, self-hosted: Inter for reading, IBM Plex Mono for codes and
// times. The display serif is gone — the shipped design sets the wordmark and
// the headlines in Inter, and --font-serif maps to the body face so anything
// still asking for `.serif` follows.
const sans = localFont({
  src: "./fonts/inter-var.woff2",
  variable: "--font-sans-loaded",
  weight: "100 900",
  display: "swap",
});

const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  // Resolved, never a literal: this deployment does not serve raildrop.app, so
  // every canonical URL and Open Graph image URL pointed at a domain that is
  // not us — and each preview deployment claimed to be production.
  metadataBase: new URL(appOrigin()),
  title: {
    default: "RailDrop. Know when your train gets cheaper",
    template: "%s · RailDrop",
  },
  description:
    "Book the trip. RailDrop watches every bookable Amtrak rail option across your window and emails you when it actually gets cheaper.",
  applicationName: "RailDrop",
  keywords: ["Amtrak", "train", "fare watch", "Northeast Corridor", "Acela"],
  openGraph: {
    title: "RailDrop. Know when your train gets cheaper",
    description: "Live Amtrak fare watch for trips you already booked.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "RailDrop",
    description: "Know when your train gets cheaper.",
  },
  robots: {
    index: true,
    follow: true,
  },
  category: "travel",
};

export const viewport: Viewport = {
  // #efe8d9 was the old paper. The Labs re-skin moved --paper to #f8f6f1 in
  // globals.css and this was left behind, so the browser chrome sat a shade
  // darker than the page it framed. One source of truth, matched by the test
  // in tests/unit/theme-color.test.ts.
  /* One per scheme, so the browser chrome follows the page instead of framing
     a near-black board in porcelain. Both are the --paper token for their
     scheme; tests/unit/theme-color.test.ts holds them to it. */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e0b" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
      /* The head script sets data-theme before React hydrates, so the client
         html element legitimately has an attribute the server did not send.
         Without this React logs a hydration mismatch on every load for anyone
         who has chosen a scheme. Scoped to this element's attributes only — it
         does not suppress anything in the tree below. */
      suppressHydrationWarning
    >
      <head>
        {/* Before first paint, deliberately.
            A stored "dark" applied from an effect means every navigation starts
            white and then snaps — a flashbulb, on the product people use at
            11pm in a station. This is the one place a blocking inline script
            earns its cost. It reads one key and sets one attribute; if storage
            is unavailable it does nothing and the media query takes over. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('raildrop.theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}",
          }}
        />
      </head>
      <body className="relative z-0 min-h-full bg-paper text-ink">
        <div className="relative z-10">
          <LocalModeBanner />
          {children}
          <EmbedAnnounce />
        </div>
      </body>
    </html>
  );
}
