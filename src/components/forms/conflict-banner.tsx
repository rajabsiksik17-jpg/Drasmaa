"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { RecordController } from "@/hooks/use-record"

type Row = { version: number }

const display = (v: unknown) => (v == null || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v))

/** "This record was updated by another user" with Reload / Review / Continue. */
export function ConflictBanner<T extends Row>({ rec, labels = {} }: { rec: RecordController<T>; labels?: Record<string, string> }) {
  const t = useTranslations("conflict")
  const [review, setReview] = useState(false)
  const latest = rec.conflict
  const fields = latest ? [...rec.pendingFields].filter((f) => !Object.is((latest as Record<string, unknown>)[f], (rec.values as Record<string, unknown>)[f])) : []

  return (
    <>
      <AnimatePresence>
        {latest && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="no-print overflow-hidden"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
              <AlertTriangle className="size-4 text-warning-foreground dark:text-warning" />
              <span className="flex-1 font-medium">{t("title")}</span>
              <Button size="sm" variant="outline" onClick={() => setReview(true)}>
                {t("review")}
              </Button>
              <Button size="sm" onClick={rec.reloadLatest}>
                {t("reload")}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Dialog open={review && !!latest} onOpenChange={setReview}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("reviewTitle")}</DialogTitle>
            <DialogDescription>{t("reviewBody")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-start text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t("field")}</th>
                  <th className="p-2 text-start">{t("theirs")}</th>
                  <th className="p-2 text-start">{t("mine")}</th>
                </tr>
              </thead>
              <tbody>
                {fields.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-3 text-muted-foreground">
                      {t("noOverlap")}
                    </td>
                  </tr>
                )}
                {fields.map((f) => (
                  <tr key={f} className="border-t">
                    <td className="p-2 font-medium">{labels[f] ?? f}</td>
                    <td className="p-2">{display((latest as Record<string, unknown> | null)?.[f])}</td>
                    <td className="p-2">{display((rec.values as Record<string, unknown>)[f])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { rec.reloadLatest(); setReview(false) }}>
              {t("reload")}
            </Button>
            <Button onClick={() => { rec.keepMine(); setReview(false) }}>{t("keepMine")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
