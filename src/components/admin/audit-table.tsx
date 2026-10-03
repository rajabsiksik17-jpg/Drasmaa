"use client"

import { Fragment, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronDown, ScrollText } from "lucide-react"
import { EmptyState } from "@/components/common/page"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { AuditLog } from "@/types/db"

const show = (v: unknown) =>
  v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)

export function AuditTable({ rows, actors }: { rows: AuditLog[]; actors: Record<string, string> }) {
  const t = useTranslations("audit")
  const locale = useLocale()
  const [open, setOpen] = useState<number | null>(null)
  if (rows.length === 0) return <EmptyState icon={ScrollText} title={t("empty")} />
  return (
    <div className="scroll-x rounded-xl border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-start font-medium">{t("when")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("who")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("action")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("entity")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("fields")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("reason")}</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expanded = open === r.id
            const fields = r.changed_fields ?? Object.keys(r.after ?? r.before ?? {}).filter((k) => !["created_at", "updated_at", "version", "created_by", "updated_by"].includes(k))
            return (
              <Fragment key={r.id}>
                <tr className="cursor-pointer border-t hover:bg-muted/30" onClick={() => setOpen(expanded ? null : r.id)}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.occurred_at, locale)}</td>
                  <td className="px-3 py-2">
                    {r.actor_id ? (actors[r.actor_id] ?? r.actor_id.slice(0, 8)) : t("system")}
                    {r.actor_role && <span className="block text-xs text-muted-foreground">{r.actor_role}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        r.action === "insert" && "bg-success/12 text-success",
                        r.action === "update" && "bg-info/12 text-info",
                        r.action === "delete" && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {t(`actions.${r.action}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.entity_type}</td>
                  <td className="max-w-64 truncate px-3 py-2 text-xs text-muted-foreground">{r.action === "update" ? fields.join(", ") : "—"}</td>
                  <td className="max-w-48 truncate px-3 py-2 text-xs">{r.reason ?? ""}</td>
                  <td className="px-2">
                    <ChevronDown className={cn("size-4 text-muted-foreground transition", expanded && "rotate-180")} />
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-muted/20">
                    <td colSpan={7} className="px-3 py-3">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="py-1 text-start font-medium">{t("field")}</th>
                            <th className="py-1 text-start font-medium">{t("before")}</th>
                            <th className="py-1 text-start font-medium">{t("after")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map((f) => (
                            <tr key={f} className="border-t border-border/60 align-top">
                              <td className="py-1 pe-3 font-mono">{f}</td>
                              <td className="py-1 pe-3 break-all text-destructive/80">{show(r.before?.[f])}</td>
                              <td className="py-1 break-all text-success">{show(r.after?.[f])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
