import { cookies, headers } from "next/headers"
import { getRequestConfig } from "next-intl/server"
import { LOCALE_COOKIE, defaultLocale, isLocale } from "./config"

// Locale is a user preference (cookie, synced to profiles.locale) rather
// than part of the URL, so switching language keeps the user exactly where
// they are and never changes any stored data.
export default getRequestConfig(async () => {
  const store = await cookies()
  // Print views may be rendered in the document's language (set by the proxy).
  const forced = (await headers()).get("x-clinic-locale")
  const fromCookie = store.get(LOCALE_COOKIE)?.value
  const locale = isLocale(forced) ? forced : isLocale(fromCookie) ? fromCookie : defaultLocale
  return {
    locale,
    timeZone: "Asia/Amman",
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
