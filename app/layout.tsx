import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Hotel SaaS", template: "%s · Hotel SaaS" },
  description: "Room QR guest services and hotel operations.",
  // Staff/admin app: keep private pages out of search engines.
  robots: { index: false, follow: false },
  // Staff PWA (app/manifest.ts): home-screen install on iOS/Android.
  appleWebApp: { capable: true, title: "Hotel Staff", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f2a44" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
