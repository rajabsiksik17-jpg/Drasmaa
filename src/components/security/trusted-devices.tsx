"use client"


import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Laptop, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useActionError } from "@/hooks/use-action-error"
import { revokeTrustedDevice } from "@/lib/actions/security"
import { formatDate, formatDateTime } from "@/lib/dates"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export interface TrustedDeviceRow {
  id: string
  label: string | null
  created_at: string
  last_used_at: string
  expires_at: string
}

export function TrustedDevices({ devices }: { devices: TrustedDeviceRow[] }) {
  const t = useTranslations("sessions")
  const locale = useLocale()
  const router = useRouter()
  const { message } = useActionError()
  const [pending, start] = useSafeTransition()
  if (devices.length === 0) return <p className="text-sm text-muted-foreground">{t("noTrusted")}</p>
  return (
    <ul className="divide-y">
      {devices.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-2.5">
          <Laptop className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{d.label ?? t("unknownDevice")}</p>
            <p className="text-xs text-muted-foreground">
              {t("trustedSince", { date: formatDateTime(d.created_at, locale) })} · {t("trustedUntil", { date: formatDate(d.expires_at.slice(0, 10)) })}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await revokeTrustedDevice(d.id)
                if (!res.ok) return void toast.error(message(res.error))
                toast.success(t("untrusted"))
                router.refresh()
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <X />}
            {t("untrust")}
          </Button>
        </li>
      ))}
    </ul>
  )
}
