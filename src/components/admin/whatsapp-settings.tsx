"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { CheckCircle2, Info, Loader2, MessageCircle, Phone, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { NativeSelect } from "@/components/common/native-select"
import { SectionCard } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { saveWhatsappSettings } from "@/lib/actions/security"
import { formatInternational, normalizeWhatsAppNumber } from "@/lib/messaging/whatsapp"
import { useSafeTransition } from "@/hooks/use-safe-transition"

type Settings = { whatsapp_enabled: boolean; whatsapp_country_code: string; whatsapp_open_mode: "auto" | "web" | "app" }

export function WhatsappSettings({ initial }: { initial: Settings }) {
  const t = useTranslations("whatsappSettings")
  const router = useRouter()
  const { showError } = useActionError()
  const [v, setV] = useState(initial)
  const [sample, setSample] = useState("0791234567")
  const [pending, start] = useSafeTransition()
  const normalized = normalizeWhatsAppNumber(sample, v.whatsapp_country_code)

  const save = () =>
    start(async () => {
      const res = await saveWhatsappSettings(v)
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-xl border bg-primary/[0.04] p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">{t("explain")}</p>
      </div>

      <SectionCard title={t("settings")} icon={MessageCircle}>
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">{t("enabled")}</span>
              <span className="block text-xs text-muted-foreground">{t("enabledHint")}</span>
            </span>
            <Switch checked={v.whatsapp_enabled} onCheckedChange={(c) => setV({ ...v, whatsapp_enabled: c })} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="wa-cc">{t("countryCode")}</Label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">+</span>
                <Input
                  id="wa-cc"
                  dir="ltr"
                  inputMode="numeric"
                  value={v.whatsapp_country_code}
                  onChange={(e) => setV({ ...v, whatsapp_country_code: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wa-mode">{t("openMode")}</Label>
              <NativeSelect id="wa-mode" value={v.whatsapp_open_mode} onChange={(e) => setV({ ...v, whatsapp_open_mode: e.target.value as Settings["whatsapp_open_mode"] })}>
                <option value="auto">{t("mode.auto")}</option>
                <option value="web">{t("mode.web")}</option>
                <option value="app">{t("mode.app")}</option>
              </NativeSelect>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {t("save")}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("tester")} icon={Phone}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="wa-sample">{t("testerInput")}</Label>
            <Input id="wa-sample" dir="ltr" value={sample} onChange={(e) => setSample(e.target.value)} />
          </div>
          <p className="flex items-center gap-2 pb-2 text-sm font-medium" dir="ltr">
            {normalized.ok ? (
              <>
                <CheckCircle2 className="size-4 text-emerald-600" />
                {formatInternational(normalized.number)}
              </>
            ) : (
              <>
                <XCircle className="size-4 text-destructive" />
                <span className="text-destructive">{t("invalid")}</span>
              </>
            )}
          </p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("templatesHint")}{" "}
          <Link href="/admin/templates" className="font-medium text-primary underline-offset-2 hover:underline">
            {t("openTemplates")}
          </Link>
        </p>
      </SectionCard>
    </div>
  )
}
