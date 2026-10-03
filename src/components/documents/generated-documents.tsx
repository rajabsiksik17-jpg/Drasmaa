"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Download, Eye, FileStack, Loader2, Mail, MessageCircle, MoreHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { SectionCard } from "@/components/common/page"
import { useCan } from "@/components/app-context"
import { MessageComposer, type ComposerChannel } from "@/components/messaging/message-composer"
import { useActionError } from "@/hooks/use-action-error"
import { useRealtime } from "@/lib/realtime/use-realtime"
import { deleteGeneratedDocument, type GeneratedDocumentRow } from "@/lib/actions/generated-documents"
import { formatBytes } from "@/lib/storage/files"
import { formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"

/** Patient → Documents → Generated documents (immutable PDF snapshots, newest first). */
export function GeneratedDocuments({ patientId, documents }: { patientId: string; documents: GeneratedDocumentRow[] }) {
  const t = useTranslations("generatedDocs")
  const td = useTranslations("documentTypes")
  const locale = useLocale()
  const can = useCan()
  const router = useRouter()
  const { message } = useActionError()
  const [compose, setCompose] = useState<{ id: string; channel: ComposerChannel } | null>(null)
  const [deleting, setDeleting] = useState<GeneratedDocumentRow | null>(null)
  const [reason, setReason] = useState("")
  const [pending, start] = useTransition()
  const [showRemoved, setShowRemoved] = useState(false)

  useRealtime(`gendocs:${patientId}`, [{ table: "generated_documents", filter: `patient_id=eq.${patientId}` }], () => router.refresh())

  const shown = documents.filter((d) => showRemoved || d.status === "generated")
  const removedCount = documents.length - documents.filter((d) => d.status === "generated").length

  return (
    <SectionCard
      title={t("title")}
      icon={FileStack}
      bodyClassName="p-0"
      actions={
        removedCount > 0 && (
          <Button size="xs" variant="ghost" onClick={() => setShowRemoved((v) => !v)}>
            {showRemoved ? t("hideRemoved") : t("showRemoved", { count: removedCount })}
          </Button>
        )
      }
    >
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {shown.map((d) => {
            const live = d.status === "generated"
            return (
              <li key={d.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-2.5", !live && "opacity-55")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {d.file_name}
                  </p>
                  <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span>{td(d.document_type)}</span>
                    <span>· {formatDateTime(d.generated_at, locale)}</span>
                    <span>· {t("by", { name: d.generator?.full_name ?? "—" })}</span>
                    <span>· {formatBytes(d.size_bytes)}</span>
                    <span>· {d.language === "ar" ? "AR" : "EN"}</span>
                    <span>· {t("version", { n: d.version_no })}</span>
                    {!live && <span className="text-destructive">· {t(`status.${d.status}`)}</span>}
                  </p>
                </div>
                {live && (
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="ghost" asChild aria-label={t("preview")}>
                      <a href={`/api/generated-documents/${d.id}`} target="_blank" rel="noopener">
                        <Eye />
                      </a>
                    </Button>
                    <Button size="icon-sm" variant="ghost" asChild aria-label={t("download")}>
                      <a href={`/api/generated-documents/${d.id}?download=1`}>
                        <Download />
                      </a>
                    </Button>
                    {(can(P.documentsShare) || can(P.documentsDelete)) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={t("more")}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {can(P.documentsShare) && can(P.messagesPrepareWhatsapp) && (
                            <DropdownMenuItem onSelect={() => setCompose({ id: d.id, channel: "whatsapp" })}>
                              <MessageCircle />
                              WhatsApp
                            </DropdownMenuItem>
                          )}
                          {can(P.documentsShare) && can(P.messagesSendEmail) && (
                            <DropdownMenuItem onSelect={() => setCompose({ id: d.id, channel: "email" })}>
                              <Mail />
                              {t("email")}
                            </DropdownMenuItem>
                          )}
                          {can(P.documentsDelete) && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(d)}>
                                <Trash2 />
                                {t("delete")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {compose && (
        <MessageComposer
          open
          onOpenChange={(o) => !o && setCompose(null)}
          patientId={patientId}
          generatedDocumentId={compose.id}
          channel={compose.channel}
          purpose="document_share"
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="gd-reason">{t("reason")}</Label>
            <Textarea id="gd-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                start(async () => {
                  if (!deleting) return
                  const res = await deleteGeneratedDocument(deleting.id, reason)
                  if (!res.ok) return void toast.error(message(res.error))
                  toast.success(t("deleted"))
                  setDeleting(null)
                  setReason("")
                  router.refresh()
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
