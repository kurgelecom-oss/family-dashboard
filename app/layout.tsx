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
        {children}
      </body>
    </html>
  );
}
