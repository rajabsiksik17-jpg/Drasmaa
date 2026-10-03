"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { motion } from "motion/react"
import {
  Archive,
  Copy,
  Eye,
  History,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Send,
  Variable,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect } from "@/components/common/native-select"
import { EmptyState } from "@/components/common/page"
import { useActionError } from "@/hooks/use-action-error"
import {
  archiveTemplate,
  duplicateTemplate,
  listTemplateVersions,
  restoreTemplateVersion,
  saveTemplate,
  sendTemplateTest,
  setTemplateActive,
  type MessageTemplate,
  type TemplateVersion,
} from "@/lib/actions/templates"
import { VARIABLE_GROUPS, renderTemplate, sampleVariables, unknownVariables, type TemplateVariable } from "@/lib/messaging/templates"
import { formatDateTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

const CATEGORIES = ["appointment", "medical_followup", "pregnancy", "fertility", "ivf", "general", "congratulations", "administrative", "documents", "custom"] as const
const PURPOSES = [
  "custom",
  "appointment_reminder",
  "appointment_confirmation",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_followup",
  "followup_reminder",
  "pregnancy_followup_reminder",
  "fertility_followup_reminder",
  "fertility_followup",
  "ivf_appointment_reminder",
  "ivf_appointment",
  "investigation_result",
  "welcome",
  "registration_confirmation",
  "general_message",
  "birthday",
  "pregnancy_congratulations",
  "thank_you",
  "document_share",
] as const

type Channel = "email" | "whatsapp"
type ClinicVars = { name: string; phone: string; address: string }

type Draft = Omit<MessageTemplate, "id" | "code" | "is_system" | "archived_at" | "sort_order" | "created_at" | "updated_at" | "created_by" | "updated_by" | "version"> & {
  id?: string
  version?: number
}

const emptyDraft = (channel: Channel): Draft => ({
  channel,
  category: "custom",
  purpose: "custom",
  name_en: "",
  name_ar: "",
  subject_en: channel === "email" ? "" : null,
  subject_ar: channel === "email" ? "" : null,
  body_en: "",
  body_ar: "",
  default_language: "ar",
  active: true,
})

export function TemplatesManager({
  templates,
  userNames,
  clinic,
  can,
  userEmail,
}: {
  templates: MessageTemplate[]
  userNames: Record<string, string>
  clinic: { en: ClinicVars; ar: ClinicVars }
  can: { create: boolean; edit: boolean; delete: boolean }
  userEmail: string
}) {
  const t = useTranslations("templates")
  const locale = useLocale()
  const router = useRouter()
  const { message } = useActionError()
  const [channel, setChannel] = useState<Channel>("email")
  const [query, setQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<{ draft: Draft; template: MessageTemplate | null } | null>(null)
  const [, start] = useTransition()

  const list = useMemo(
    () =>
      templates.filter(
        (tp) =>
          tp.channel === channel &&
          (showArchived ? !!tp.archived_at : !tp.archived_at) &&
          (!query || `${tp.name_en} ${tp.name_ar}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [templates, channel, showArchived, query],
  )
  const name = (tp: { name_en: string; name_ar: string }) => (locale === "ar" ? tp.name_ar : tp.name_en)

  const act = (fn: () => Promise<{ ok: boolean; error?: Parameters<typeof message>[0] }>, success: string) =>
    start(async () => {
      const res = await fn()
      if (!res.ok) return void toast.error(message(res.error!))
      toast.success(success)
      router.refresh()
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="tablist">
          {(["email", "whatsapp"] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={channel === c}
              onClick={() => setChannel(c)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                channel === c ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c === "email" ? <Mail className="size-4" /> : <MessageCircle className="size-4" />}
              {t(`channel.${c}`)}
            </button>
          ))}
        </div>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="ps-8" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          {t("showArchived")}
        </label>
        {can.create && (
          <Button className="ms-auto" onClick={() => setEditing({ draft: emptyDraft(channel), template: null })}>
            <Plus />
            {t("new")}
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState icon={channel === "email" ? Mail : MessageCircle} title={t("empty")} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((tp) => (
            <motion.li
              key={tp.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("flex flex-col rounded-xl border bg-card p-4 shadow-xs", !tp.active && "opacity-70")}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{name(tp)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-px">{t(`category.${tp.category}`)}</span>
                    {tp.is_system && (
                      <span className="inline-flex items-center gap-0.5">
                        <Lock className="size-3" />
                        {t("builtIn")}
                      </span>
                    )}
                    {tp.archived_at && <span className="text-destructive">{t("archived")}</span>}
                  </p>
                </div>
                {can.edit && !tp.archived_at && (
                  <Switch
                    checked={tp.active}
                    onCheckedChange={(v) => act(() => setTemplateActive(tp.id, v), v ? t("activated") : t("deactivated"))}
                    aria-label={t("active")}
                  />
                )}
              </div>
              <p className="mt-2 line-clamp-3 flex-1 text-xs whitespace-pre-line text-muted-foreground" dir="auto">
                {tp.default_language === "ar" ? tp.body_ar : tp.body_en}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("modified", { date: formatDateTime(tp.updated_at, locale), name: userNames[tp.updated_by ?? ""] ?? t("system") })}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setEditing({ draft: { ...tp }, template: tp })}>
                  <Eye />
                  {can.edit && tp.category !== "security" ? t("edit") : t("view")}
                </Button>
                {can.create && tp.category !== "security" && (
                  <Button size="sm" variant="ghost" onClick={() => act(() => duplicateTemplate(tp.id), t("duplicated"))}>
                    <Copy />
                    {t("duplicate")}
                  </Button>
                )}
                {can.delete && !tp.is_system && !tp.archived_at && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => act(() => archiveTemplate(tp.id), t("archivedToast"))}>
                    <Archive />
                    {t("delete")}
                  </Button>
                )}
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      {editing && (
        <TemplateEditor
          key={editing.template?.id ?? "new"}
          initial={editing.draft}
          template={editing.template}
          readOnly={!(editing.template ? can.edit : can.create)}
          clinic={clinic}
          userNames={userNames}
          userEmail={userEmail}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function TemplateEditor({
  initial,
  template,
  readOnly,
  clinic,
  userNames,
  userEmail,
  onClose,
}: {
  initial: Draft
  template: MessageTemplate | null
  readOnly: boolean
  clinic: { en: ClinicVars; ar: ClinicVars }
  userNames: Record<string, string>
  userEmail: string
  onClose: () => void
}) {
  const t = useTranslations("templates")
  const tv = useTranslations("templates.variables")
  const locale = useLocale()
  const router = useRouter()
  const { message, showError } = useActionError()
  const [d, setD] = useState<Draft>(initial)
  const [lang, setLang] = useState<"ar" | "en">(initial.default_language)
  const [saving, startSave] = useTransition()
  const [testing, startTest] = useTransition()
  const [testTo, setTestTo] = useState(userEmail)
  const [versions, setVersions] = useState<TemplateVersion[] | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const isEmail = d.channel === "email"
  const isSecurity = d.category === "security"

  const bodyKey = lang === "ar" ? "body_ar" : "body_en"
  const subjectKey = lang === "ar" ? "subject_ar" : "subject_en"
  const sample = sampleVariables(lang, clinic[lang])
  const unknown = unknownVariables(`${d[subjectKey] ?? ""} ${d[bodyKey]}`)

  const insertVar = (v: TemplateVariable) => {
    const el = bodyRef.current
    const token = `{{${v}}}`
    if (!el) return setD((p) => ({ ...p, [bodyKey]: `${p[bodyKey]}${token}` }))
    const startPos = el.selectionStart ?? el.value.length
    const endPos = el.selectionEnd ?? startPos
    const next = el.value.slice(0, startPos) + token + el.value.slice(endPos)
    setD((p) => ({ ...p, [bodyKey]: next }))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(startPos + token.length, startPos + token.length)
    })
  }

  const save = () =>
    startSave(async () => {
      const res = await saveTemplate({
        id: d.id,
        expectedVersion: d.version,
        channel: d.channel,
        category: d.category as (typeof CATEGORIES)[number],
        purpose: d.purpose,
        name_en: d.name_en,
        name_ar: d.name_ar,
        subject_en: d.subject_en,
        subject_ar: d.subject_ar,
        body_en: d.body_en,
        body_ar: d.body_ar,
        default_language: d.default_language,
        active: d.active,
      })
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
      onClose()
    })

  const sendTest = () =>
    startTest(async () => {
      const res = await sendTemplateTest({ subject: d[subjectKey] ?? "", body: d[bodyKey], language: lang, to: testTo })
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("testSent", { to: testTo }))
    })

  const [, start] = useTransition()
  const openVersions = () =>
    start(async () => {
      if (!template) return
      const res = await listTemplateVersions(template.id)
      if (res.ok) setVersions(res.data)
      else toast.error(message(res.error))
    })

  const restore = (v: TemplateVersion) =>
    start(async () => {
      const res = await restoreTemplateVersion(v.id)
      if (!res.ok) return void toast.error(message(res.error))
      toast.success(t("restored", { version: v.version_no }))
      setVersions(null)
      router.refresh()
      onClose()
    })

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {isEmail ? <Mail className="size-4" /> : <MessageCircle className="size-4" />}
            {template ? (locale === "ar" ? template.name_ar : template.name_en) : t("new")}
          </SheetTitle>
          <SheetDescription>
            {template
              ? t("meta", {
                  created: formatDateTime(template.created_at, locale),
                  by: userNames[template.created_by ?? ""] ?? t("system"),
                  updated: formatDateTime(template.updated_at, locale),
                })
              : t("newHint")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tp-name-ar">{t("nameAr")}</Label>
              <Input id="tp-name-ar" dir="rtl" value={d.name_ar} disabled={readOnly} onChange={(e) => setD({ ...d, name_ar: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tp-name-en">{t("nameEn")}</Label>
              <Input id="tp-name-en" dir="ltr" value={d.name_en} disabled={readOnly} onChange={(e) => setD({ ...d, name_en: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tp-cat">{t("categoryLabel")}</Label>
              <NativeSelect id="tp-cat" value={d.category} disabled={readOnly || isSecurity} onChange={(e) => setD({ ...d, category: e.target.value })}>
                {(isSecurity ? ["security"] : CATEGORIES).map((c) => (
                  <option key={c} value={c}>
                    {t(`category.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tp-purpose">{t("purposeLabel")}</Label>
              <NativeSelect id="tp-purpose" value={d.purpose} disabled={readOnly || isSecurity || !!template?.is_system} onChange={(e) => setD({ ...d, purpose: e.target.value })}>
                {(PURPOSES as readonly string[]).includes(d.purpose) ? null : <option value={d.purpose}>{d.purpose}</option>}
                {PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {t(`purpose.${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tp-lang">{t("defaultLanguage")}</Label>
              <NativeSelect id="tp-lang" value={d.default_language} disabled={readOnly} onChange={(e) => setD({ ...d, default_language: e.target.value as "ar" | "en" })}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch checked={d.active} disabled={readOnly} onCheckedChange={(v) => setD({ ...d, active: v })} />
              {t("active")}
            </label>
          </div>

          <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="tablist" aria-label={t("language")}>
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                role="tab"
                aria-selected={lang === l}
                onClick={() => setLang(l)}
                className={cn("rounded-md px-3 py-1 text-sm font-medium", lang === l ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {l === "ar" ? "العربية" : "English"}
              </button>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              {isEmail && (
                <div className="grid gap-1.5">
                  <Label htmlFor="tp-subject">{t("subject")}</Label>
                  <Input
                    id="tp-subject"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                    value={d[subjectKey] ?? ""}
                    disabled={readOnly}
                    onChange={(e) => setD({ ...d, [subjectKey]: e.target.value.replace(/[\r\n]/g, " ") })}
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="tp-body">{t("body")}</Label>
                <Textarea
                  id="tp-body"
                  ref={bodyRef}
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  value={d[bodyKey]}
                  disabled={readOnly}
                  onChange={(e) => setD({ ...d, [bodyKey]: e.target.value })}
                  className="min-h-64 font-[inherit] leading-relaxed"
                />
                {unknown.length > 0 && <p className="text-xs text-destructive">{t("unknownVars", { vars: unknown.join(", ") })}</p>}
              </div>
              {!readOnly && (
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Variable className="size-3.5" />
                    {t("variablesTitle")}
                  </p>
                  {Object.entries(VARIABLE_GROUPS)
                    .filter(([g]) => g !== "security" || isSecurity)
                    .map(([group, vars]) => (
                      <div key={group} className="flex flex-wrap gap-1">
                        {vars.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => insertVar(v)}
                            title={`{{${v}}}`}
                            className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] hover:border-primary hover:text-primary"
                          >
                            {tv(v)}
                          </button>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Eye className="size-3.5" />
                {t("preview")}
              </p>
              <div className={cn("rounded-xl border p-4 text-sm", isEmail ? "bg-card" : "bg-[#e7f7e1] text-[#111] dark:bg-emerald-950/40 dark:text-emerald-50")} dir={lang === "ar" ? "rtl" : "ltr"}>
                {isEmail && <p className="mb-2 border-b pb-2 font-semibold">{renderTemplate(d[subjectKey] ?? "", sample)}</p>}
                <p className="leading-relaxed whitespace-pre-wrap">{renderTemplate(d[bodyKey], sample)}</p>
              </div>
              {isEmail && !readOnly && (
                <div className="flex items-end gap-2">
                  <div className="grid flex-1 gap-1.5">
                    <Label htmlFor="tp-test" className="text-xs">
                      {t("sendTestTo")}
                    </Label>
                    <Input id="tp-test" type="email" dir="ltr" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                  </div>
                  <Button variant="outline" onClick={sendTest} disabled={testing}>
                    {testing ? <Loader2 className="animate-spin" /> : <Send />}
                    {t("sendTest")}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {template && (
              <Button variant="ghost" onClick={openVersions}>
                <History />
                {t("versions")}
              </Button>
            )}
            <div className="ms-auto flex gap-2">
              <Button variant="outline" onClick={onClose}>
                {t("close")}
              </Button>
              {!readOnly && (
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2 className="animate-spin" />}
                  {t("save")}
                </Button>
              )}
            </div>
          </div>
        </div>

        <Dialog open={versions !== null} onOpenChange={(o) => !o && setVersions(null)}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("versions")}</DialogTitle>
              <DialogDescription>{t("versionsHint")}</DialogDescription>
            </DialogHeader>
            <ul className="space-y-2">
              {(versions ?? []).map((v, i) => (
                <li key={v.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{t("versionNo", { n: v.version_no })}</span>
                    {i === 0 && <span className="rounded bg-primary/10 px-1.5 text-[11px] text-primary">{t("current")}</span>}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(v.created_at, locale)} · {userNames[v.created_by ?? ""] ?? t("system")}
                    </span>
                    {i > 0 && !readOnly && (
                      <Button size="xs" variant="outline" className="ms-auto" onClick={() => restore(v)}>
                        <RotateCcw />
                        {t("restore")}
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-4 text-xs whitespace-pre-line text-muted-foreground" dir="auto">
                    {lang === "ar" ? v.body_ar : v.body_en}
                  </p>
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}
