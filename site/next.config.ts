import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Images are served same-origin from R2 via /images/* (no external optimizer on Workers).
  images: { unoptimized: true },
  async redirects() {
    return [
      { source: "/rss", destination: "/feed.xml", permanent: true },
      { source: "/rss/", destination: "/feed.xml", permanent: true },
    ];
  },
};

// Makes Cloudflare bindings (DB, IMAGES) available under `next dev`.
initOpenNextCloudflareForDev();

export default nextConfig;
