import type { Metadata } from "next";
import "./globals.css";
import TopNav from "./components/TopNav";
import FamilyEditGate from "./components/FamilyEditGate";
import HourlyShift from "./components/HourlyShift";
import NightMode from "./components/NightMode";

export const metadata: Metadata = {
  title: "Kurgel Family Dashboard",
  description: "Family operating system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Fraunces is the boards' display face. A CSS @import of it is dropped once
          bundled after globals.css, so it is linked here, once, for every route. */}
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- app router root layout, applies to every page */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800&display=swap" />
      </head>
      <body>
        <TopNav />
        <FamilyEditGate />
        {/* The OriginsStrip banner is retired everywhere (owner, 2026-08-26):
            origins pressure exists only as the corner nudges on "/". --strip-h
            is zeroed at the end of globals.css so every surface that subtracts
            it reclaims the height without touching its own math. */}
        {children}
        <HourlyShift />
        <NightMode />
      </body>
    </html>
  );
}
