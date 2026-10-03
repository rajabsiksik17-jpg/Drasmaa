import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { ConfigEditor } from "@/components/admin/config-editor"
import { cn } from "@/lib/utils"

export const metadata = { title: "Dropdown options" }

// Configurable dropdown categories. Fixed clinical structures (G/P, LMP,
// O/I days, R/L follicle grid) are intentionally not configurable.
const CATEGORIES = ["appointment_type", "oi_protocol", "delivery_type", "uterus_finding"] as const

export default async function OptionsPage({ searchParams }: PageProps<"/admin/options">) {
  await requirePagePermission(P.settingsManage)
  const t = await getTranslations("admin")
  const sp = await searchParams
  const category = CATEGORIES.includes(sp.category as (typeof CATEGORIES)[number]) ? (sp.category as string) : CATEGORIES[0]
  const supabase = await createClient()
  const { data } = await supabase.from("dropdown_options").select("*").eq("category", category).order("sort_order")
  return (
    <>
      <PageHeader title={t("options")} description={t("optionsHint")} />
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`?category=${c}`}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", c === category ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {t(`category.${c}`)}
          </Link>
        ))}
      </div>
      <ConfigEditor
        key={category}
        table="dropdown_options"
        rows={data ?? []}
        fixed={{ category }}
        columns={[
          { key: "value", label: t("value"), type: "code", immutable: true, dir: "ltr", width: "160px" },
          { key: "label_en", label: t("labelEn"), dir: "ltr" },
          { key: "label_ar", label: t("labelAr"), dir: "rtl" },
        ]}
      />
    </>
  )
}
