import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { LocalModeBanner } from "@/components/local-mode-banner";
import "./globals.css";

// The Labs family type, self-hosted: Inter for reading, IBM Plex Mono for codes and times.
const sans = localFont({
  src: "./fonts/inter-var.woff2",
  variable: "--font-sans-loaded",
  weight: "100 900",
  display: "swap",
});

const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://rail-drop3.vercel.app"),
  title: {
    default: "RailDrop — Know when your train gets cheaper",
    template: "%s · RailDrop",
  },
  description:
    "Book the trip. RailDrop watches every bookable Amtrak rail option across your window and emails you when it actually gets cheaper.",
  applicationName: "RailDrop",
  keywords: ["Amtrak", "train", "fare watch", "Northeast Corridor", "Acela"],
  openGraph: {
    title: "RailDrop — Know when your train gets cheaper",
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
  themeColor: "#f8f6f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="relative z-0 min-h-full bg-paper text-ink">
        <div className="relative z-10">
          <LocalModeBanner />
          {children}
        </div>
      </body>
    </html>
  );
}
