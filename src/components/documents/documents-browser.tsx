"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { Archive, ArchiveRestore, FileImage, FileText, FileUp, FolderOpen } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { EmptyState } from "@/components/common/page"
import { DocumentLink } from "@/components/documents/document-link"
import { DOCUMENT_CATEGORIES, UploadDialog } from "@/components/documents/upload-dialog"
import { useCan } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { setDocumentArchived } from "@/lib/actions/documents"
import { formatDateTime } from "@/lib/dates"
import { formatBytes } from "@/lib/storage/files"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { DocumentCategory, PatientDocument } from "@/types/db"

export function DocumentsBrowser({
  patientId,
  documents,
  people,
}: {
  patientId: string
  documents: PatientDocument[]
  people: Record<string, string>
}) {
  const t = useTranslations("documents")
  const locale = useLocale()
  const can = useCan()
  const router = useRouter()
  const { showError } = useActionError()
  const [filter, setFilter] = useState<DocumentCategory | "all" | "archived">("all")
  const [uploadOpen, setUploadOpen] = useState(false)
  const [confirm, setConfirm] = useState<PatientDocument | null>(null)
  const [pending, start] = useTransition()

  const visible = documents.filter((d) =>
    filter === "archived" ? d.status === "archived" : d.status === "active" && (filter === "all" || d.category === filter),
  )
  const counts = (c: DocumentCategory) => documents.filter((d) => d.status === "active" && d.category === c).length
  const latestOf = new Map<string, string>()
  for (const d of documents) if (d.status === "active" && !latestOf.has(d.category)) latestOf.set(d.category, d.id)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
          {(["all", ...DOCUMENT_CATEGORIES, "archived"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition",
                filter === c ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {c === "all" ? t("all") : c === "archived" ? t("archived") : `${t(`categories.${c}`)} (${counts(c)})`}
            </button>
          ))}
        </div>
        {can(P.documentsUpload) && (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <FileUp />
            {t("upload")}
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={t("empty")}
          action={
            can(P.documentsUpload) ? (
              <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                <FileUp />
                {t("upload")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {visible.map((d) => {
              const Icon = d.mime_type.startsWith("image/") ? FileImage : FileText
              return (
                <motion.li key={d.id} layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                  <div className={cn("flex gap-3 rounded-xl border bg-card p-3 shadow-xs", d.status === "archived" && "opacity-60")}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-sm font-medium" title={d.file_name}>
                        {d.title || d.file_name}
                      </p>
                      <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5">{t(`categories.${d.category}`)}</span>
                        {latestOf.get(d.category) === d.id ? (
                          <span className="rounded bg-success/12 px-1.5 text-success">{t("latest")}</span>
                        ) : d.status === "active" ? (
                          <span className="rounded bg-muted px-1.5">{t("previous")}</span>
                        ) : null}
                        {formatBytes(d.size_bytes)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(d.uploaded_at, locale)}
                        {d.uploaded_by && people[d.uploaded_by] ? ` · ${people[d.uploaded_by]}` : ""}
                      </p>
                      {d.notes && <p className="line-clamp-2 text-xs">{d.notes}</p>}
                      <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                        <DocumentLink documentId={d.id} />
                        <DocumentLink documentId={d.id} download />
                        {can(P.documentsArchive) && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() => (d.status === "archived" ? start(async () => {
                              const res = await setDocumentArchived(d.id, false)
                              if (!res.ok) return showError(res.error)
                              router.refresh()
                            }) : setConfirm(d))}
                            disabled={pending}
                          >
                            {d.status === "archived" ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                            {d.status === "archived" ? t("restore") : t("archive")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} links={{ patientId }} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("archiveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("archiveBody", { name: confirm?.file_name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirm &&
                start(async () => {
                  const res = await setDocumentArchived(confirm.id, true, "Archived from documents tab")
                  setConfirm(null)
                  if (!res.ok) return showError(res.error)
                  toast.success(t("archivedDone"))
                  router.refresh()
                })
              }
            >
              {t("archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
