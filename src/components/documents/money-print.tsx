/** Server-side money formatting for printed documents (LTR digits). */
export function moneyText(value: number, currency: string, locale: string) {
  const digits = currency === "JOD" || currency === "KWD" || currency === "BHD" ? 3 : 2
  return new Intl.NumberFormat(locale === "ar" ? "ar-JO-u-nu-latn" : "en-JO", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0)
}

export function MoneyCell({ value, currency, locale, bold }: { value: number; currency: string; locale: string; bold?: boolean }) {
  return (
    <span dir="ltr" className={bold ? "font-bold tabular-nums" : "tabular-nums"}>
      {moneyText(value, currency, locale)}
    </span>
  )
}
