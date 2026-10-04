"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { FileSignature, FileText, FileUp, Paperclip, Pill, Receipt, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCan } from "@/components/app-context"
import { DocumentLink } from "@/components/documents/document-link"
import { EncounterStatusBadge } from "@/components/encounters/encounter-status"
import { InvoiceStatusBadge } from "@/components/accounting/money"
import { formatDateTime, formatTime } from "@/lib/dates"
import { P } from "@/lib/permissions"
import type { EncounterStatus, InvoiceStatus, PatientDocument } from "@/types/db"

const UploadDialog = dynamic(() => import("@/components/documents/upload-dialog").then((m) => m.UploadDialog), { ssr: false })

/** Time, clinic-visit status and payment state + the visit's contextual actions. */
export function VisitQuickActions({
  patientId,
  visitId,
  startedAt,
  encounter,
  invoice,
  open,
}: {
  patientId: string
  visitId: string
  startedAt: string
  encounter: { status: EncounterStatus; prepay: boolean } | null
  invoice: { status: InvoiceStatus } | null
  open: boolean
}) {
  const t = useTranslations("visits.quick")
  const locale = useLocale()
  const can = useCan()
  const [upload, setUpload] = useState(false)
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
      <span className="text-xs text-muted-foreground">{t("startedAt", { time: formatTime(startedAt, locale) })}</span>
      {encounter && <EncounterStatusBadge status={encounter.status} prepay={encounter.prepay} />}
      {invoice && <InvoiceStatusBadge status={invoice.status} />}
      <div className="no-print ms-auto flex flex-wrap gap-1.5">
        {invoice && open && (can(P.billingCharge) || can(P.accountingCreate)) && (
          <Button size="sm" variant="outline" onClick={() => jump("vx-billing")}>
            <Receipt />
            {t("addService")}
          </Button>
        )}
        {can(P.documentsUpload) && (
          <Button size="sm" variant="outline" onClick={() => setUpload(true)}>
            <FileUp />
            {t("addDocument")}
          </Button>
        )}
        {can(P.prescriptionsCreate) && (
          <Button size="sm" variant="outline" onClick={() => jump("vx-rx")}>
            <Pill />
            {t("prescription")}
          </Button>
        )}
        {can(P.reportsCreate) && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/reports/new?patient=${patientId}`}>
              <FileSignature />
              {t("report")}
            </Link>
          </Button>
        )}
        {can(P.drawingsCreate) && (
          <Button size="sm" variant="outline" onClick={() => jump("vx-imaging")}>
            <ScanLine />
            {t("ultrasound")}
          </Button>
        )}
      </div>
      {upload && <UploadDialog open onOpenChange={setUpload} links={{ patientId, visitId }} />}
    </div>
  )
}

/** Files attached to this visit (any type); the patient's other files stay in the profile. */
export function VisitAttachments({ patientId, visitId, documents, people }: { patientId: string; visitId: string; documents: PatientDocument[]; people: Record<string, string> }) {
  const t = useTranslations("documents")
  const locale = useLocale()
  const can = useCan()
  const [upload, setUpload] = useState(false)
  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("emptyVisit")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {documents.map((d) => (
            <li key={d.id} className="flex gap-3 rounded-lg border bg-card p-3 text-sm">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                {d.mime_type.startsWith("image/") ? <Paperclip className="size-4" /> : <FileText className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" title={d.file_name}>
                  {d.title || d.file_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`categories.${d.category}`)} · {t("uploadedBy", { when: formatDateTime(d.uploaded_at, locale), who: (d.uploaded_by && people[d.uploaded_by]) || "—" })}
                </p>
                <div className="mt-1 flex gap-3 text-xs">
                  <DocumentLink documentId={d.id} />
                  <DocumentLink documentId={d.id} download />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {can(P.documentsUpload) && (
        <Button size="sm" variant="outline" onClick={() => setUpload(true)}>
          <FileUp />
          {t("upload")}
        </Button>
      )}
      {upload && <UploadDialog open onOpenChange={setUpload} links={{ patientId, visitId }} />}
    </div>
  )
}
