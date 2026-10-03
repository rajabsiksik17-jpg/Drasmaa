import { getTranslations } from "next-intl/server"
import { LanguageSwitch } from "@/components/auth/language-switch"

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("auth")
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, white 0, transparent 40%), radial-gradient(circle at 80% 70%, white 0, transparent 35%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/15 backdrop-blur">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10Z" />
              <path d="M12 9v5M9.5 11.5h5" />
            </svg>
          </span>
          <span className="text-lg font-semibold">{t("brand")}</span>
        </div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold">{t("heroTitle")}</h2>
          <p className="text-primary-foreground/80">{t("heroBody")}</p>
          <ul className="grid gap-2 pt-2 text-sm text-primary-foreground/90">
            <li>• {t("heroPoint1")}</li>
            <li>• {t("heroPoint2")}</li>
            <li>• {t("heroPoint3")}</li>
          </ul>
        </div>
        <p className="relative text-xs text-primary-foreground/60">{t("privacy")}</p>
      </aside>
      <main className="relative flex flex-col items-center justify-center px-4 py-12">
        <div className="absolute end-4 top-4">
          <LanguageSwitch />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
