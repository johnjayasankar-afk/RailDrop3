import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Instrument_Serif } from "next/font/google";
import { LocalModeBanner } from "@/components/local-mode-banner";
import { appOrigin } from "@/lib/config";
import "./globals.css";
import "./labs-glass.css";
import { LabsUI } from "@/components/labs-ui";

// The Labs family faces, from files in this repo: no build-time fetch, and the
// same two faces every other product in the family sets its words in. The
// timetable serif stays, because the departure board is what RailDrop is.
const geistSans = localFont({
  src: "./fonts/inter-var.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-geist-mono",
  display: "swap",
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
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
  themeColor: "#f8f6f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrument.variable} h-full antialiased`}
    >
      <body className="relative z-0 min-h-full bg-paper text-ink">
        <div className="relative z-10">
          <LocalModeBanner />
          {children}
          <LabsUI />
        </div>
      </body>
    </html>
  );
}
