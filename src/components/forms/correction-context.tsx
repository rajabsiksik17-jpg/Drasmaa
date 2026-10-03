"use client"

import { createContext, useContext, useState } from "react"
import { useTranslations } from "next-intl"
import { motion } from "motion/react"
import { History, Lock, PencilLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

/**
 * Completed / historical records are read-only until the user explicitly
 * starts a correction and gives a reason. The reason travels with every
 * save (x-audit-reason) and is stored in the audit log; the database
 * refuses the change without it.
 */
const CorrectionContext = createContext<{ reason: string | null; locked: boolean }>({ reason: null, locked: false })

export function useCorrectionReason() {
  return useContext(CorrectionContext).reason
}

export function useRecordLocked() {
  return useContext(CorrectionContext).locked
}

/** Low-level scope for custom (e.g. per-row) correction UIs. */
export function ReasonScope({ reason, locked, children }: { reason: string | null; locked: boolean; children: React.ReactNode }) {
  return <CorrectionContext.Provider value={{ reason, locked }}>{children}</CorrectionContext.Provider>
}

/** Small dialog asking for a correction reason; returns it via onConfirm. */
export function ReasonDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => void
}) {
  const t = useTranslations("correction")
  const [draft, setDraft] = useState("")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="row-correction-reason">{t("reason")}</Label>
          <Textarea id="row-correction-reason" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("reasonPlaceholder")} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={draft.trim().length < 3}
            onClick={() => {
              onConfirm(draft.trim())
              setDraft("")
              onOpenChange(false)
            }}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CorrectionProvider({
  historical,
  canCorrect,
  children,
  label,
}: {
  /** True when the record is completed/historical. */
  historical: boolean
  canCorrect: boolean
  label?: string
  children: React.ReactNode
}) {
  const t = useTranslations("correction")
  const [reason, setReason] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const locked = historical && !reason

  return (
    <CorrectionContext.Provider value={{ reason, locked }}>
      {historical && (
        <motion.div
          layout
          className={
            reason
              ? "no-print mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
              : "no-print mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/60 px-3 py-2 text-sm"
          }
        >
          {reason ? <PencilLine className="size-4 text-warning-foreground dark:text-warning" /> : <Lock className="size-4 text-muted-foreground" />}
          <span className="flex-1">
            {reason ? t("correcting", { reason }) : (label ?? t("locked"))}
          </span>
          {reason ? (
            <Button size="sm" variant="outline" onClick={() => setReason(null)}>
              {t("finish")}
            </Button>
          ) : (
            canCorrect && (
              <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                <History />
                {t("start")}
              </Button>
            )
          )}
        </motion.div>
      )}
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="correction-reason">{t("reason")}</Label>
            <Textarea
              id="correction-reason"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={draft.trim().length < 3}
              onClick={() => {
                setReason(draft.trim())
                setOpen(false)
              }}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CorrectionContext.Provider>
  )
}
