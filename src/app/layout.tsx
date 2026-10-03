import type { Metadata, Viewport } from "next"
import { Cairo } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getLocale } from "next-intl/server"
import { headers } from "next/headers"
import { Providers } from "@/components/providers"
import { directionOf, isLocale } from "@/i18n/config"
import "./globals.css"

// Cairo is the single typeface of the application (Latin + Arabic),
// self-hosted by next/font (no runtime request to Google, no layout shift).
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["latin", "arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: "Clinic EMR", template: "%s · Clinic EMR" },
  description: "Gynecology, fertility, IVF and pregnancy clinic management",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#151a22" },
  ],
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : "en"
  const dir = directionOf(locale)
  const nonce = (await headers()).get("x-nonce") ?? undefined
  return (
    // suppressHydrationWarning applies to <html>'s own attributes only:
    // next-themes sets the theme class before React hydrates (documented requirement).
    <html lang={locale} dir={dir} suppressHydrationWarning className={`${cairo.variable} h-full antialiased`}>
      <body className="min-h-full">
        <NextIntlClientProvider>
          <Providers dir={dir} nonce={nonce}>
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
