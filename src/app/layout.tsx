import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { LocalModeBanner } from "@/components/local-mode-banner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://raildrop.app"),
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
  themeColor: "#efe8d9",
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
        </div>
      </body>
    </html>
  );
}
