"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  History,
  Inbox,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  PlugZap,
  Send,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { NativeSelect } from "@/components/common/native-select"
import { SectionCard } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import { saveEmailAccount, testEmailConnection, type ConnectionTestResult } from "@/lib/actions/email-settings"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

type Security = "ssl" | "tls" | "starttls" | "none"

export interface EmailAccountView {
  id: string
  email_address: string
  display_name: string
  smtp_host: string
  smtp_port: number
  smtp_security: Security
  smtp_username: string
  imap_enabled: boolean
  imap_host: string | null
  imap_port: number | null
  imap_security: Security | null
  imap_username: string | null
  smtp_status: "unknown" | "ok" | "failed"
  imap_status: "unknown" | "ok" | "failed" | "disabled"
  last_test_at: string | null
  last_success_email_at: string | null
  last_failed_email_at: string | null
  last_error_code: string | null
  updated_at: string
}

export interface EmailTestRow {
  id: string
  tested_at: string
  smtp_connected: boolean | null
  smtp_authenticated: boolean | null
  smtp_test_sent: boolean | null
  imap_connected: boolean | null
  imap_authenticated: boolean | null
  error_code: string | null
  duration_ms: number | null
  tester: { full_name: string } | null
}

function StatusPill({ status }: { status: string }) {
  const t = useTranslations("emailSettings.status")
  const tone =
    status === "ok"
      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
      : status === "failed"
        ? "bg-destructive/12 text-destructive"
        : "bg-muted text-muted-foreground"
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{t(status)}</span>
}

function Step({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return null
  return (
    <motion.li initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}
      <span className={cn(!ok && "text-destructive")}>{label}</span>
    </motion.li>
  )
}

export function EmailSettings({
  account,
  tests,
  canManage,
  encryptionReady,
  serviceReady,
  userEmail,
}: {
  account: EmailAccountView | null
  tests: EmailTestRow[]
  canManage: boolean
  encryptionReady: boolean
  serviceReady: boolean
  userEmail: string
}) {
  const t = useTranslations("emailSettings")
  const locale = useLocale()
  const router = useRouter()
  const { showError, message } = useActionError()
  const [saving, startSave] = useTransition()
  const [testing, startTest] = useTransition()
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  const [sendTo, setSendTo] = useState(userEmail)
  const [v, setV] = useState({
    email_address: account?.email_address ?? "",
    display_name: account?.display_name ?? "",
    smtp_host: account?.smtp_host ?? "",
    smtp_port: account?.smtp_port ?? 587,
    smtp_security: (account?.smtp_security ?? "tls") as Security,
    smtp_username: account?.smtp_username ?? "",
    smtp_password: "",
    imap_enabled: account?.imap_enabled ?? false,
    imap_host: account?.imap_host ?? "",
    imap_port: account?.imap_port ?? 993,
    imap_security: (account?.imap_security ?? "ssl") as Security,
    imap_username: account?.imap_username ?? "",
    imap_password: "",
  })
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [k]: value }))
  const disabled = !canManage || !encryptionReady || !serviceReady
  const err = (code: string | null) => (code ? t(`errorCodes.${code}`) : "")

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    startSave(async () => {
      const res = await saveEmailAccount({ ...v, imap_host: v.imap_host || undefined, imap_username: v.imap_username || undefined })
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      setV((p) => ({ ...p, smtp_password: "", imap_password: "" }))
      router.refresh()
    })
  }

  const test = () =>
    startTest(async () => {
      setResult(null)
      const res = await testEmailConnection({ sendTo })
      if (!res.ok) return void toast.error(message(res.error))
      setResult(res.data)
      router.refresh()
    })

  const field = (key: keyof typeof v, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`em-${key}`}>{label}</Label>
      <Input
        id={`em-${key}`}
        value={v[key] as string | number}
        onChange={(e) => set(key, (props.type === "number" ? Number(e.target.value) : e.target.value) as never)}
        disabled={disabled}
        dir="ltr"
        {...props}
      />
    </div>
  )

  const passwordField = (key: "smtp_password" | "imap_password", stored: boolean) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`em-${key}`} className="flex items-center gap-2">
        {t("password")}
        {stored && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Lock className="size-3" />
            {t("storedEncrypted")}
          </span>
        )}
      </Label>
      <Input
        id={`em-${key}`}
        type="password"
        autoComplete="new-password"
        value={v[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={stored ? t("keepPassword") : ""}
        disabled={disabled}
        dir="ltr"
      />
    </div>
  )

  const securitySelect = (key: "smtp_security" | "imap_security", imap = false) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`em-${key}`}>{t("encryption")}</Label>
      <NativeSelect id={`em-${key}`} value={v[key]} onChange={(e) => set(key, e.target.value as Security)} disabled={disabled}>
        <option value="ssl">{t("security.ssl")}</option>
        {!imap && <option value="tls">{t("security.tls")}</option>}
        <option value="starttls">{t("security.starttls")}</option>
        <option value="none">{t("security.none")}</option>
      </NativeSelect>
    </div>
  )

  return (
    <div className="space-y-5">
      {(!encryptionReady || !serviceReady) && (
        <div role="alert" className="flex gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            {!encryptionReady && <p>{t("encryptionMissing")}</p>}
            {!serviceReady && <p>{t("serviceMissing")}</p>}
          </div>
        </div>
      )}

      <SectionCard title={t("diagnostics")} icon={Activity}>
        {account ? (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t("account")}</dt>
              <dd className="font-medium" dir="ltr">{account.email_address}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("smtpStatus")}</dt>
              <dd><StatusPill status={account.smtp_status} /></dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("imapStatus")}</dt>
              <dd><StatusPill status={account.imap_status} /></dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("lastTest")}</dt>
              <dd>{account.last_test_at ? formatDateTime(account.last_test_at, locale) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("lastSuccess")}</dt>
              <dd>{account.last_success_email_at ? formatDateTime(account.last_success_email_at, locale) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("lastFailure")}</dt>
              <dd>{account.last_failed_email_at ? formatDateTime(account.last_failed_email_at, locale) : "—"}</dd>
            </div>
            {account.last_error_code && (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs text-muted-foreground">{t("lastError")}</dt>
                <dd className="text-destructive">{err(account.last_error_code)}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("notConfigured")}</p>
        )}
      </SectionCard>

      <form onSubmit={save} className="space-y-5">
        <SectionCard title={t("sender")} icon={Mail}>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("email_address", t("emailAddress"), { type: "email", placeholder: "clinic@example.com" })}
            {field("display_name", t("displayName"), { dir: "auto", placeholder: t("displayNamePlaceholder") })}
          </div>
        </SectionCard>

        <SectionCard title={t("smtp")} icon={Send}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">{field("smtp_host", t("host"), { placeholder: "smtp.example.com" })}</div>
            {field("smtp_port", t("port"), { type: "number", min: 1, max: 65535 })}
            {securitySelect("smtp_security")}
            <div className="sm:col-span-2">{field("smtp_username", t("username"), { autoComplete: "off" })}</div>
            <div className="sm:col-span-2">{passwordField("smtp_password", !!account)}</div>
          </div>
        </SectionCard>

        <SectionCard
          title={t("imap")}
          icon={Inbox}
          actions={
            <label className="flex items-center gap-2 text-xs font-medium">
              {t("imapEnabled")}
              <Switch checked={v.imap_enabled} onCheckedChange={(c) => set("imap_enabled", c)} disabled={disabled} />
            </label>
          }
        >
          <AnimatePresence initial={false}>
            {v.imap_enabled ? (
              <motion.div key="imap" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">{field("imap_host", t("host"), { placeholder: "imap.example.com" })}</div>
                  {field("imap_port", t("port"), { type: "number", min: 1, max: 65535 })}
                  {securitySelect("imap_security", true)}
                  <div className="sm:col-span-2">{field("imap_username", t("username"), { autoComplete: "off" })}</div>
                  <div className="sm:col-span-2">{passwordField("imap_password", !!account?.imap_enabled)}</div>
                </div>
              </motion.div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("imapHint")}</p>
            )}
          </AnimatePresence>
        </SectionCard>

        {canManage && (
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" />
              {t("securityNote")}
            </p>
            <Button type="submit" disabled={disabled || saving}>
              {saving && <Loader2 className="animate-spin" />}
              {t("save")}
            </Button>
          </div>
        )}
      </form>

      {account && canManage && (
        <SectionCard title={t("testConnection")} icon={PlugZap}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-60 flex-1 gap-1.5">
              <Label htmlFor="em-test-to">{t("testRecipient")}</Label>
              <Input id="em-test-to" type="email" dir="ltr" value={sendTo} onChange={(e) => setSendTo(e.target.value)} />
            </div>
            <Button onClick={test} disabled={testing || disabled}>
              {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
              {testing ? t("testing") : t("runTest")}
            </Button>
          </div>
          {result && (
            <div className="mt-4 grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
              <ul className="space-y-1.5">
                <li className="text-xs font-semibold text-muted-foreground uppercase">SMTP</li>
                <Step ok={result.smtp.connected} label={result.smtp.connected ? t("steps.smtpConnected") : t("steps.smtpConnectFailed")} />
                {result.smtp.connected && (
                  <Step ok={result.smtp.authenticated} label={result.smtp.authenticated ? t("steps.authOk") : t("steps.authFailed")} />
                )}
                <Step ok={result.smtp.sent} label={result.smtp.sent ? t("steps.sent") : t("steps.sendFailed")} />
                {result.smtp.error && <li className="text-xs text-destructive">{err(result.smtp.error)}</li>}
              </ul>
              <ul className="space-y-1.5">
                <li className="text-xs font-semibold text-muted-foreground uppercase">IMAP</li>
                {result.imap.enabled ? (
                  <>
                    <Step ok={result.imap.connected} label={result.imap.connected ? t("steps.imapConnected") : t("steps.imapConnectFailed")} />
                    {result.imap.connected && (
                      <Step ok={result.imap.authenticated} label={result.imap.authenticated ? t("steps.authOk") : t("steps.authFailed")} />
                    )}
                    {result.imap.error && <li className="text-xs text-destructive">{err(result.imap.error)}</li>}
                  </>
                ) : (
                  <li className="text-sm text-muted-foreground">{t("status.disabled")}</li>
                )}
              </ul>
            </div>
          )}
        </SectionCard>
      )}

      {tests.length > 0 && (
        <SectionCard title={t("history")} icon={History} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{t("testedAt")}</th>
                  <th className="px-4 py-2 text-start font-medium">SMTP</th>
                  <th className="px-4 py-2 text-start font-medium">{t("testEmail")}</th>
                  <th className="px-4 py-2 text-start font-medium">IMAP</th>
                  <th className="px-4 py-2 text-start font-medium">{t("testedBy")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("result")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tests.map((r) => {
                  const icon = (v: boolean | null) =>
                    v == null ? <span className="text-muted-foreground">—</span> : v ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(r.tested_at, locale)}</td>
                      <td className="px-4 py-2">{icon(r.smtp_authenticated)}</td>
                      <td className="px-4 py-2">{icon(r.smtp_test_sent)}</td>
                      <td className="px-4 py-2">{icon(r.imap_authenticated)}</td>
                      <td className="px-4 py-2">{r.tester?.full_name ?? "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.error_code ? <span className="text-destructive">{err(r.error_code)}</span> : t("status.ok")}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
