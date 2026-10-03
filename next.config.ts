import path from "node:path"
import type { NextConfig } from "next"

// next-intl's request config is wired with the same module alias its
// plugin would register (`next-intl/config`). The alias is declared here
// directly so the build does not need the plugin's optional native SWC
// dependency (used only for message extraction, which we don't use).
const I18N_REQUEST_CONFIG = "./src/i18n/request.ts"

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Same-origin framing is needed for in-app document previews; other sites
  // can never frame the application (CSP frame-ancestors 'self' as well).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native / large server-only packages loaded at runtime (PDF + email).
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "nodemailer", "imapflow"],
  turbopack: {
    resolveAlias: { "next-intl/config": I18N_REQUEST_CONFIG },
  },
  webpack(config) {
    config.resolve ??= {}
    config.resolve.alias = { ...config.resolve.alias, "next-intl/config": path.resolve(I18N_REQUEST_CONFIG) }
    return config
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }]
  },
}

export default nextConfig
