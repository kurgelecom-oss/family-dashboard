import type { Metadata } from "next";
import "./globals.css";
import TopNav from "./components/TopNav";
import OriginsStrip from "./components/OriginsStrip";

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
        {/* Directly below the nav, every route, always visible. Hides itself on
            /ansar; surfaces subtract --strip-h so it costs no card space. */}
        <OriginsStrip />
        {children}
      </body>
    </html>
  );
}
