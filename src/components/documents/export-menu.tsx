"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { FileDown, FileText, Mail, MessageCircle, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useCan } from "@/components/app-context"
import { ExportDialog, type ExportIntent, type ExportTarget } from "@/components/documents/export-dialog"
import { DOCUMENTS } from "@/lib/documents/registry"
import { P } from "@/lib/permissions"

/** Contextual [Export] button: PDF · Print · WhatsApp · Email. Hidden without permission. */
export function ExportMenu({
  target,
  size = "sm",
  label,
  className,
}: {
  target: ExportTarget
  size?: "sm" | "default" | "icon-sm"
  label?: string
  className?: string
}) {
  const t = useTranslations("export")
  const can = useCan()
  const [intent, setIntent] = useState<ExportIntent | null>(null)
  const cfg = DOCUMENTS[target.type]
  const allowed = can(P.documentsGenerate) && cfg.permissions.every((p) => can(p))
  if (!allowed) return null
  const printHref = `${cfg.route(target.entityId)}?autoprint=1`
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} variant="outline" className={className} aria-label={t("export")}>
            <FileDown />
            {size !== "icon-sm" && <span className="hidden sm:inline">{label ?? t("export")}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setIntent("pdf")}>
            <FileText />
            {t("exportPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={printHref} target="_blank" rel="noopener">
              <Printer />
              {t("print")}
            </a>
          </DropdownMenuItem>
          {can(P.documentsShare) && (
            <>
              <DropdownMenuSeparator />
              {can(P.messagesPrepareWhatsapp) && (
                <DropdownMenuItem onSelect={() => setIntent("whatsapp")}>
                  <MessageCircle />
                  {t("whatsapp")}
                </DropdownMenuItem>
              )}
              {can(P.messagesSendEmail) && (
                <DropdownMenuItem onSelect={() => setIntent("email")}>
                  <Mail />
                  {t("email")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {intent && <ExportDialog open onOpenChange={(o) => !o && setIntent(null)} target={target} intent={intent} />}
    </>
  )
}
