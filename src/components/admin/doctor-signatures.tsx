"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { CheckCircle2, Loader2, PenLine, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { removeDoctorSignature, uploadDoctorSignature } from "@/lib/actions/admin"

type DoctorRow = { id: string; name: string; hasSignature: boolean; active: boolean }

/** Optional signature images, used only on documents the doctor generates. */
export function DoctorSignatures({ doctors }: { doctors: DoctorRow[] }) {
  const t = useTranslations("admin.signatures")
  const router = useRouter()
  const { showError } = useActionError()
  const [busy, setBusy] = useState<string | null>(null)
  const [, start] = useTransition()
  const input = useRef<HTMLInputElement>(null)
  const target = useRef<string | null>(null)

  const pick = (id: string) => {
    target.current = id
    input.current?.click()
  }
  const onFile = (file: File | undefined) => {
    const id = target.current
    if (!file || !id) return
    setBusy(id)
    start(async () => {
      const fd = new FormData()
      fd.set("doctorId", id)
      fd.set("file", file)
      const res = await uploadDoctorSignature(fd)
      setBusy(null)
      if (input.current) input.current.value = ""
      if (!res.ok) return showError(res.error)
      toast.success(t("uploaded"))
      router.refresh()
    })
  }
  const remove = (id: string) => {
    setBusy(id)
    start(async () => {
      const res = await removeDoctorSignature(id)
      setBusy(null)
      if (!res.ok) return showError(res.error)
      toast.success(t("removed"))
      router.refresh()
    })
  }

  return (
    <SectionCard title={t("title")} icon={PenLine} className="mt-5">
      <p className="mb-3 text-sm text-muted-foreground">{t("hint")}</p>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <ul className="divide-y">
        {doctors
          .filter((d) => d.active)
          .map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-sm font-medium">{d.name}</span>
              {d.hasSignature ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5" />
                  {t("configured")}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{t("none")}</span>
              )}
              <Button size="sm" variant="outline" onClick={() => pick(d.id)} disabled={busy === d.id}>
                {busy === d.id ? <Loader2 className="animate-spin" /> : <Upload />}
                {d.hasSignature ? t("replace") : t("upload")}
              </Button>
              {d.hasSignature && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(d.id)} disabled={busy === d.id}>
                  <Trash2 />
                  {t("remove")}
                </Button>
              )}
            </li>
          ))}
      </ul>
    </SectionCard>
  )
}
