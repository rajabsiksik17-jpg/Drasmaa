"use client"

import { useCallback, useState, useTransition } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { Bell, ChevronDown, FileText, Loader2, Mail, MessageCircle, MessagesSquare, Send, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState, SectionCard } from "@/components/common/page"
import { useCan } from "@/components/app-context"
import { MessageComposer, type ComposerChannel } from "@/components/messaging/message-composer"
import { listCommunications, type CommunicationEntry } from "@/lib/actions/messages"
import { useRealtime } from "@/lib/realtime/use-realtime"
import { formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const CHANNEL_ICON = { whatsapp: MessageCircle, email: Mail, in_app: Bell, system: Settings2 }

const STATUS_TONE: Record<string, string> = {
  prepared: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  opened: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  queued: "bg-muted text-muted-foreground",
  sent: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/12 text-destructive",
  skipped: "bg-muted text-muted-foreground",
}

/** Patient → Communication history (live). WhatsApp is never shown as "delivered". */
export function CommunicationHistory({ patientId, initial }: { patientId: string; initial: CommunicationEntry[] }) {
  const t = useTranslations("communications")
  const locale = useLocale()
  const can = useCan()
  const [rows, setRows] = useState<CommunicationEntry[] | null>(initial)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [more, setMore] = useState(initial.length === 30)
  const [compose, setCompose] = useState<ComposerChannel | null>(null)
  const [pending, start] = useTransition()

  const load = useCallback(async () => {
    const res = await listCommunications(patientId)
    if (res.ok) {
      setRows(res.data)
      setMore(res.data.length === 30)
    } else setRows([])
  }, [patientId])

  useRealtime(`comms:${patientId}`, [{ table: "communication_logs", filter: `patient_id=eq.${patientId}` }], () => void load())

  const loadMore = () =>
    start(async () => {
      const last = rows?.at(-1)
      if (!last) return
      const res = await listCommunications(patientId, last.created_at)
      if (!res.ok) return
      setRows((prev) => [...(prev ?? []), ...res.data])
      setMore(res.data.length === 30)
    })

  const canSend = can(P.messagesSend)
  return (
    <SectionCard
      title={t("title")}
      icon={MessagesSquare}
      bodyClassName="p-0"
      actions={
        canSend && (
          <>
            {can(P.messagesPrepareWhatsapp) && (
              <Button size="xs" variant="ghost" className="text-[#128C7E]" onClick={() => setCompose("whatsapp")}>
                <MessageCircle />
                WhatsApp
              </Button>
            )}
            {can(P.messagesSendEmail) && (
              <Button size="xs" variant="ghost" onClick={() => setCompose("email")}>
                <Send className="rtl:-scale-x-100" />
                {t("email")}
              </Button>
            )}
          </>
        )
      }
    >
      {rows === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={MessagesSquare} title={t("empty")} description={t("emptyHint")} />
        </div>
      ) : (
        <>
          <div className="hidden grid-cols-[9rem_6.5rem_1fr_1fr_8rem_6rem_1.5rem] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span>{t("date")}</span>
            <span>{t("channel")}</span>
            <span>{t("template")}</span>
            <span>{t("recipient")}</span>
            <span>{t("user")}</span>
            <span>{t("status")}</span>
            <span />
          </div>
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {rows.map((r) => {
                const Icon = CHANNEL_ICON[r.channel]
                const open = expanded === r.id
                return (
                  <motion.li key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : r.id)}
                      className="grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-2.5 text-start text-sm hover:bg-muted/40 md:grid-cols-[9rem_6.5rem_1fr_1fr_8rem_6rem_1.5rem] md:items-center"
                    >
                      <span className="text-xs text-muted-foreground md:text-sm md:text-foreground">{formatDateTime(r.created_at, locale)}</span>
                      <span className="flex items-center gap-1.5 justify-self-end md:justify-self-start">
                        <Icon className={cn("size-4", r.channel === "whatsapp" ? "text-[#128C7E]" : "text-muted-foreground")} />
                        <span className="text-xs">{t(`channels.${r.channel}`)}</span>
                      </span>
                      <span className="col-span-2 flex min-w-0 items-center gap-1.5 md:col-span-1">
                        {r.generated_document_id && <FileText className="size-3.5 shrink-0 text-primary" />}
                        <span className="truncate">{r.template ? (locale === "ar" ? r.template.name_ar : r.template.name_en) : t.has(`purposes.${r.purpose}`) ? t(`purposes.${r.purpose}`) : r.purpose}</span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground md:text-sm md:text-foreground" dir="ltr">
                        {r.recipient}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{r.automated ? t("automatic") : (r.performer?.full_name ?? "—")}</span>
                      <span className="justify-self-end md:justify-self-start">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[r.status])}>{t(`statuses.${r.status}`)}</span>
                      </span>
                      <ChevronDown className={cn("hidden size-4 text-muted-foreground transition-transform md:block", open && "rotate-180")} />
                    </button>
                    {open && (
                      <div className="space-y-1 bg-muted/20 px-4 pb-3 text-sm">
                        {r.subject && <p className="pt-2 font-medium">{r.subject}</p>}
                        <p className="pt-1 leading-relaxed whitespace-pre-wrap" dir="auto">
                          {r.body}
                        </p>
                        {r.error_code && <p className="text-xs text-destructive">{t("errorCode", { code: r.error_code })}</p>}
                        {r.channel === "whatsapp" && <p className="text-[11px] text-muted-foreground">{t("whatsappNote")}</p>}
                      </div>
                    )}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
          {more && (
            <div className="flex justify-center border-t p-2">
              <Button size="sm" variant="ghost" onClick={loadMore} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {t("loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
      {compose && <MessageComposer open onOpenChange={(o) => !o && setCompose(null)} patientId={patientId} channel={compose} />}
    </SectionCard>
  )
}
