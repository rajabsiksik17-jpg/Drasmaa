import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"

export default async function NotFound() {
  const t = await getTranslations("errorPage")
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <SearchX className="size-6" />
      </span>
      <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("notFoundBody")}</p>
      <Button asChild>
        <Link href="/dashboard">{t("home")}</Link>
      </Button>
    </div>
  )
}
