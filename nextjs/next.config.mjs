import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Next only auto-loads .env files inside this directory, but the project keeps a
// single .env at the repo root so the app and the ingestion CLI share one file.
// dotenv never overrides an already-set variable, so .env.local and real
// deployment environment variables still win.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

// Set only on the Vercel shop front: the Render back end that holds the data, the
// admin panel and the agent. Unset — on Render itself and on the shop's own
// machine — none of the routing below exists and every read is local.
const backend = (process.env.PWC_BACKEND_URL ?? "").replace(/\/+$/, "");
const backendUrl = backend ? new URL(backend) : null;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shop's own photographs and the brand marks are the only images, both
  // served from this origin, so nothing needs a remote pattern.
  poweredByHeader: false,

  // `standalone` bundles the server and just the node_modules it actually uses,
  // which is what gets copied to the box. Without it a deploy means shipping the
  // whole dependency tree.
  output: "standalone",

  // Brand logos are found on disk at request time. On Vercel a function does not
  // carry public/ with it unless asked to, so without this every brand would fall
  // back to its name set in type.
  outputFileTracingIncludes: {
    "/*": ["./public/brands/**/*"],
  },

  // The watch photographs live on the back end, and on the shop front they are
  // served straight from it rather than through Vercel's optimiser. The free plan
  // allows 5,000 transformations a month; 1,600-odd listings, each resized for
  // several screen widths, would use that up early in the month, after which
  // photographs stop appearing. They are already compressed WebP (94 KB on
  // average) and the back end sends them with a year-long cache header, so each
  // visitor downloads each one once.
  images: backendUrl ? { unoptimized: true } : undefined,

  async redirects() {
    if (!backend) return [];
    // The admin panel lives with the data it edits. Sent there, not proxied, so
    // its session cookie belongs to the back end's own origin.
    return [
      { source: "/admin", destination: `${backend}/admin`, permanent: false },
      { source: "/admin/:path*", destination: `${backend}/admin/:path*`, permanent: false },
      { source: "/login", destination: `${backend}/login`, permanent: false },
      { source: "/api/admin/:path*", destination: `${backend}/api/admin/:path*`, permanent: false },
    ];
  },

  async rewrites() {
    if (!backend) return [];
    return {
      // Before the filesystem, because both paths exist in this app too and would
      // otherwise answer from a disk that is empty here.
      beforeFiles: [
        { source: "/media/:path*", destination: `${backend}/media/:path*` },
        // A customer's repair ticket is written where the shop reads it.
        { source: "/api/service", destination: `${backend}/api/service` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },

  async headers() {
    // Applied to every response. The admin panel holds customer telephone
    // numbers and addresses, so it must not be framable or sniffable, and the
    // referrer must not leak a repair ticket's URL to a third party.
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          // next/font inlines its faces; the framework needs inline styles.
          "style-src 'self' 'unsafe-inline'",
          // Next's runtime evaluates its own chunks.
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          // The back end, when the photographs are loaded from it directly.
          `img-src 'self' data: blob:${backendUrl ? ` ${backendUrl.origin}` : ""}`,
          "font-src 'self' data:",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
        ].join("; "),
      },
    ];
    return [
      { source: "/:path*", headers: base },
      {
        // Told to browsers only once the site is genuinely on HTTPS; harmless
        // before that because the header is ignored over plain HTTP.
        source: "/:path*",
        headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }],
      },
    ];
  },
};

export default nextConfig;
