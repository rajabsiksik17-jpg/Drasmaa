"use client"

import { useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { removeClinicLogo, uploadClinicLogo } from "@/lib/actions/admin"

/** Primary and secondary logos used on every generated document. */
export function LogoUploader({ primary, secondary }: { primary: string | null; secondary: string | null }) {
  const t = useTranslations("admin.center")
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useTransition()
  const input = useRef<HTMLInputElement>(null)
  const slot = useRef<"primary" | "secondary">("primary")
  const pick = (s: "primary" | "secondary") => {
    slot.current = s
    input.current?.click()
  }
  const upload = (file?: File) =>
    file &&
    start(async () => {
      const fd = new FormData()
      fd.set("slot", slot.current)
      fd.set("file", file)
      const res = await uploadClinicLogo(fd)
      if (input.current) input.current.value = ""
      if (!res.ok) return showError(res.error)
      toast.success(t("logoSaved"))
      router.refresh()
    })
  const box = (s: "primary" | "secondary", url: string | null) => (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="grid size-16 place-items-center overflow-hidden rounded-md border bg-white">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageIcon className="size-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 text-sm">
        <p className="font-medium">{s === "primary" ? t("logo") : t("secondaryLogo")}</p>
        <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => pick(s)} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Upload />}
        {t("upload")}
      </Button>
      {url && (
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-destructive"
          aria-label={t("remove")}
          onClick={() =>
            start(async () => {
              const res = await removeClinicLogo(s)
              if (!res.ok) return showError(res.error)
              router.refresh()
            })
          }
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
  return (
    <SectionCard title={t("logos")} icon={ImageIcon}>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
      <div className="grid gap-3 sm:grid-cols-2">
        {box("primary", primary)}
        {box("secondary", secondary)}
      </div>
    </SectionCard>
  )
}
