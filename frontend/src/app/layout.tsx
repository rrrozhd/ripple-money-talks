import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { Backdrop } from "@/components/backdrop";
import { Nav } from "@/components/nav";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Ripple — who depends on whom",
  description: "A research analyst agent that maps US tech supply chains and backs every company it names with the exact 10-K sentence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="relative isolate flex min-h-full flex-col font-sans">
        <Backdrop />
        <Nav />
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
