import { getTranslations } from "next-intl/server"
import { requirePagePermission } from "@/lib/auth/session"
import { P } from "@/lib/permissions"
import { PageHeader } from "@/components/common/page"
import { AccountingNav } from "@/components/accounting/accounting-nav"

export default async function AccountingLayout({ children }: LayoutProps<"/accounting">) {
  await requirePagePermission(P.accountingView)
  const t = await getTranslations("accounting")
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("title")} description={t("subtitle")} className="mb-2" />
      <AccountingNav />
      {children}
    </div>
  )
}
