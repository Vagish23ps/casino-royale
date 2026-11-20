import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compress response bodies with gzip/brotli
  compress: true,
  // Remove X-Powered-By header for security and byte reduction
  poweredByHeader: false,
  // Enable modern WebP and AVIF image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
  // Cache-Control headers for unversioned public assets (Next.js automatically handles /_next/static with 1-year immutable)
  async headers() {
    return [
      {
        // Unversioned public assets (may change; cache with background revalidation)
        source: "/:path*(svg|jpg|jpeg|png|webp|avif|ico)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
