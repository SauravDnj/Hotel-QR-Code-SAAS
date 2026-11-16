import type { MetadataRoute } from "next";

/**
 * Staff PWA (Phase 5): installable "Hotel Staff" app that opens straight to the request
 * inbox. Guests never need to install anything; their QR pages work in any browser.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hotel Staff",
    short_name: "Hotel Staff",
    description: "Guest requests and hotel operations for staff.",
    id: "/inbox",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f7f5",
    theme_color: "#1f2a44",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Open requests", url: "/inbox?view=active" }],
  };
}
