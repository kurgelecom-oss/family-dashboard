import type { Metadata } from "next";
import "./globals.css";
import TopNav from "./components/TopNav";

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
    <html lang="en">
      <body>
        <TopNav />
        {/* The OriginsStrip banner is retired everywhere (owner, 2026-08-26):
            origins pressure exists only as the corner nudges on "/". --strip-h
            is zeroed at the end of globals.css so every surface that subtracts
            it reclaims the height without touching its own math. */}
        {children}
      </body>
    </html>
  );
}
