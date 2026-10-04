"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { AnimatePresence, motion } from "motion/react"
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Loader2, Mail, MessageCircle, Send, Share2, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/common/native-select"
import { useActionError } from "@/hooks/use-action-error"
import { getMessageContext, markWhatsappOpened, prepareWhatsapp, sendPatientEmail, type MessageContext } from "@/lib/actions/messages"
import { logDocumentShare } from "@/lib/actions/generated-documents"
import { renderTemplate, sanitizeSubject } from "@/lib/messaging/templates"
import { formatInternational, normalizeWhatsAppNumber, preferredTarget } from "@/lib/messaging/whatsapp"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

export type ComposerChannel = "whatsapp" | "email"

export interface MessageComposerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null for documents about a non-registered person (standalone reports). */
  patientId: string | null
  appointmentId?: string | null
  generatedDocumentId?: string | null
  channel?: ComposerChannel
  /** Template purpose to pre-select (e.g. appointment_reminder, document_share). */
  purpose?: string
}

const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

/**
 * Message a patient: template → variables replaced on the server's data →
 * editable text → WhatsApp (prepared, opened by the user) or email (sent
 * through the clinic SMTP account). Editing never changes the template.
 */
export function MessageComposer(props: MessageComposerProps) {
  const t = useTranslations("composer")
  const { message } = useActionError()
  const [ctx, setCtx] = useState<MessageContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open) return
    let cancelled = false
    void getMessageContext({
      patientId: props.patientId,
      appointmentId: props.appointmentId ?? null,
      generatedDocumentId: props.generatedDocumentId ?? null,
    }).then((res) => {
      if (cancelled) return
      if (res.ok) setCtx(res.data)
      else setLoadError(message(res.error))
    })
    return () => {
      cancelled = true
    }
  }, [props.open, props.patientId, props.appointmentId, props.generatedDocumentId, message])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.generatedDocumentId ? t("shareDocument") : t("title")}</DialogTitle>
          <DialogDescription>{ctx ? `${ctx.patient.name} · ${ctx.patient.code}` : t("loading")}</DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {loadError}
          </p>
        ) : !ctx ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ComposerBody ctx={ctx} {...props} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ComposerBody({ ctx, channel: initialChannel, purpose, appointmentId, generatedDocumentId, patientId, onOpenChange }: MessageComposerProps & { ctx: MessageContext }) {
  const t = useTranslations("composer")
  const router = useRouter()
  const { message } = useActionError()
  const [pending, start] = useSafeTransition()
  const available: ComposerChannel[] = [...(ctx.can.whatsapp && ctx.whatsapp.enabled ? (["whatsapp"] as const) : []), ...(ctx.can.email ? (["email"] as const) : [])]
  const [channel, setChannel] = useState<ComposerChannel>(initialChannel && available.includes(initialChannel) ? initialChannel : (available[0] ?? "whatsapp"))
  const [language, setLanguage] = useState<"ar" | "en">(ctx.patient.language)

  const templates = useMemo(() => ctx.templates.filter((tp) => tp.channel === channel), [ctx.templates, channel])
  const wanted = purpose ?? (generatedDocumentId ? "document_share" : appointmentId ? "appointment_reminder" : "general_message")
  const pick = (list: typeof templates) => list.find((tp) => tp.purpose === wanted) ?? list.find((tp) => tp.purpose === "general_message") ?? list[0]
  const [templateId, setTemplateId] = useState<string>(() => pick(templates)?.id ?? "")
  const template = templates.find((tp) => tp.id === templateId) ?? null

  const render = (tp: typeof template, lang: "ar" | "en") => {
    if (!tp) return { subject: "", body: "" }
    const vars = ctx.variables[lang]
    const subject = (lang === "ar" ? tp.subject_ar || tp.subject_en : tp.subject_en || tp.subject_ar) ?? ""
    const body = lang === "ar" ? tp.body_ar || tp.body_en : tp.body_en || tp.body_ar
    return { subject: sanitizeSubject(renderTemplate(subject, vars)), body: renderTemplate(body, vars) }
  }
  const [text, setText] = useState(() => render(template, language))
  const [edited, setEdited] = useState(false)

  const applyTemplate = (id: string, lang: "ar" | "en", ch = channel) => {
    const list = ctx.templates.filter((tp) => tp.channel === ch)
    const tp = list.find((x) => x.id === id) ?? pick(list) ?? null
    setTemplateId(tp?.id ?? "")
    setText(render(tp, lang))
    setEdited(false)
  }

  // Recipient
  type Who = "patient" | "husband" | "custom"
  // Standalone report: the person is not a registered patient → manual recipient only.
  const standalone = !ctx.patient.id
  const [who, setWho] = useState<Who>(standalone ? "custom" : "patient")
  const [custom, setCustom] = useState("")
  const [customEmail, setCustomEmail] = useState("")
  const patientNumber = ctx.patient.whatsappPhone ?? ctx.patient.phone
  const rawNumber = who === "patient" ? patientNumber : who === "husband" ? ctx.patient.husbandPhone : custom
  const normalized = normalizeWhatsAppNumber(rawNumber, ctx.whatsapp.countryCode)
  const emailTo = who === "custom" ? customEmail.trim() : (ctx.patient.email ?? "")
  const emailValid = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test(emailTo)

  const [done, setDone] = useState<null | { kind: "whatsapp"; logId: string; links: { web: string; app: string; universal: string } } | { kind: "email" }>(null)
  const docUrl = generatedDocumentId ? `/api/generated-documents/${generatedDocumentId}?download=1` : null
  const target = preferredTarget(ctx.whatsapp.openMode, typeof navigator === "undefined" ? "" : navigator.userAgent)

  const downloadDocument = () => {
    if (!docUrl) return
    const a = document.createElement("a")
    a.href = docUrl
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const openWhatsapp = (logId: string, link: string) => {
    if (link.startsWith("whatsapp://")) window.location.href = link
    else window.open(link, "_blank", "noopener,noreferrer")
    void markWhatsappOpened(logId)
  }

  const prepare = () => {
    if (!normalized.ok) return void toast.error(t("invalidNumber"))
    // Open the window synchronously (popup blockers), then point it at WhatsApp.
    const popup = target === "web" ? window.open("about:blank", "_blank") : null
    start(async () => {
      const res = await prepareWhatsapp({
        patientId,
        appointmentId: appointmentId ?? null,
        generatedDocumentId: generatedDocumentId ?? null,
        templateId: templateId || null,
        purpose: template?.purpose ?? "custom",
        language,
        recipientType: who,
        customNumber: who === "custom" ? custom : undefined,
        body: text.body,
      })
      if (!res.ok) {
        popup?.close()
        return void toast.error(message(res.error))
      }
      if (docUrl) downloadDocument()
      setDone({ kind: "whatsapp", logId: res.data.logId, links: res.data.links })
      if (popup) {
        popup.opener = null
        popup.location.href = res.data.links.web
        void markWhatsappOpened(res.data.logId)
      } else if (!docUrl) {
        openWhatsapp(res.data.logId, res.data.links.universal)
      }
      router.refresh()
    })
  }

  const nativeShare = () =>
    start(async () => {
      if (!docUrl || !generatedDocumentId || !ctx.document) return
      try {
        const blob = await (await fetch(docUrl)).blob()
        const file = new File([blob], ctx.document.fileName, { type: "application/pdf" })
        if (!navigator.canShare?.({ files: [file] })) return void toast.error(t("shareUnsupported"))
        await navigator.share({ files: [file], text: text.body })
        await logDocumentShare(generatedDocumentId, "shared_native")
        toast.success(t("shared"))
        onOpenChange(false)
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast.error(t("shareUnsupported"))
      }
    })

  const sendEmail = () =>
    start(async () => {
      const res = await sendPatientEmail({
        patientId,
        appointmentId: appointmentId ?? null,
        generatedDocumentId: generatedDocumentId ?? null,
        templateId: templateId || null,
        purpose: template?.purpose ?? "custom",
        language,
        recipientType: who === "custom" ? "custom" : "patient",
        to: who === "custom" ? customEmail : undefined,
        subject: text.subject,
        body: text.body,
      })
      if (!res.ok) return void toast.error(message(res.error))
      setDone({ kind: "email" })
      toast.success(t("emailSent", { to: emailTo }))
      router.refresh()
    })

  if (available.length === 0) return <p className="text-sm text-muted-foreground">{t("noChannel")}</p>

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">{done.kind === "email" ? t("emailSentTitle") : t("preparedTitle")}</p>
            <p className="text-muted-foreground">
              {done.kind === "email" ? t("emailSentBody", { to: emailTo }) : docUrl ? t("preparedWithDocument") : t("preparedBody")}
            </p>
          </div>
        </div>
        {done.kind === "whatsapp" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openWhatsapp(done.logId, done.links.web)} variant={target === "web" ? "default" : "outline"}>
              <ExternalLink />
              {t("openWeb")}
            </Button>
            <Button onClick={() => openWhatsapp(done.logId, done.links.universal)} variant={target === "web" ? "outline" : "default"}>
              <Smartphone />
              {t("openApp")}
            </Button>
            {docUrl && (
              <Button variant="ghost" onClick={downloadDocument}>
                <Download />
                {t("downloadAgain")}
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{done.kind === "whatsapp" ? t("noDeliveryClaim") : t("emailStatusNote")}</p>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="space-y-4">
      {ctx.document && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
            {ctx.document.fileName}
          </span>
          <a href={`/api/generated-documents/${ctx.document.id}`} target="_blank" rel="noopener" className="text-xs text-primary hover:underline">
            {t("preview")}
          </a>
        </div>
      )}

      {available.length > 1 && (
        <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1" role="tablist">
          {available.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={channel === c}
              onClick={() => {
                setChannel(c)
                setWho(standalone || (c === "email" && !ctx.patient.email) ? "custom" : "patient")
                applyTemplate("", language, c)
              }}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition",
                channel === c ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                c === "whatsapp" && channel === c && "text-[#128C7E]",
              )}
            >
              {c === "whatsapp" ? <MessageCircle className="size-4" /> : <Mail className="size-4" />}
              {t(`channel.${c}`)}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1.5">
          <Label htmlFor="mc-template">{t("template")}</Label>
          <NativeSelect id="mc-template" value={templateId} onChange={(e) => applyTemplate(e.target.value, language)}>
            {templates.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {language === "ar" ? tp.name_ar : tp.name_en}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label>{t("language")}</Label>
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => {
                  setLanguage(l)
                  applyTemplate(templateId, l)
                }}
                className={cn("rounded-md px-3 py-1 text-sm", language === l ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
              >
                {l === "ar" ? "عربي" : "EN"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">{t("recipient")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {(standalone ? (["custom"] as const) : channel === "whatsapp" ? (["patient", "husband", "custom"] as const) : (["patient", "custom"] as const)).map((w) => {
            const disabled = (w === "husband" && !ctx.patient.husbandPhone) || (w === "patient" && channel === "email" && !ctx.patient.email)
            return (
              <button
                key={w}
                type="button"
                disabled={disabled}
                onClick={() => setWho(w)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-40",
                  who === w ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {t(`who.${w}`)}
              </button>
            )
          })}
        </div>
        {channel === "whatsapp" ? (
          <>
            {who === "custom" && (
              <div className="flex items-center gap-2" dir="ltr">
                <span className="text-sm text-muted-foreground">+{ctx.whatsapp.countryCode}</span>
                <Input inputMode="tel" placeholder="07X XXX XXXX" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t("customNumber")} />
              </div>
            )}
            <p className={cn("flex items-center gap-1.5 text-xs", normalized.ok ? "text-muted-foreground" : "text-destructive")}>
              {normalized.ok ? (
                <>
                  <MessageCircle className="size-3.5 text-[#25D366]" />
                  <span dir="ltr">{formatInternational(normalized.number)}</span>
                  {who === "patient" && !ctx.patient.whatsappPhone && <span>· {t("usingPhone")}</span>}
                </>
              ) : (
                <>
                  <AlertTriangle className="size-3.5" />
                  {rawNumber ? t("invalidNumber") : t("noNumber")}
                </>
              )}
            </p>
          </>
        ) : who === "custom" ? (
          <Input type="email" dir="ltr" placeholder="name@example.com" value={customEmail} onChange={(e) => setCustomEmail(e.target.value)} aria-label={t("customEmail")} />
        ) : (
          <p className="text-xs text-muted-foreground" dir="ltr">
            {ctx.patient.email}
          </p>
        )}
      </fieldset>

      {channel === "email" && (
        <div className="grid gap-1.5">
          <Label htmlFor="mc-subject">{t("subject")}</Label>
          <Input
            id="mc-subject"
            dir={language === "ar" ? "rtl" : "ltr"}
            value={text.subject}
            onChange={(e) => {
              setText({ ...text, subject: e.target.value.replace(/[\r\n]/g, " ") })
              setEdited(true)
            }}
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="mc-body" className="flex items-center justify-between">
          {t("message")}
          <AnimatePresence>
            {edited && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[11px] font-normal text-muted-foreground">
                {t("editedNote")}
              </motion.span>
            )}
          </AnimatePresence>
        </Label>
        <Textarea
          id="mc-body"
          dir={language === "ar" ? "rtl" : "ltr"}
          value={text.body}
          onChange={(e) => {
            setText({ ...text, body: e.target.value })
            setEdited(true)
          }}
          className={cn("min-h-52 leading-relaxed", channel === "whatsapp" && "bg-[#f0fbf4] dark:bg-emerald-950/30")}
          maxLength={4000}
        />
      </div>

      {channel === "email" && !ctx.emailConfigured && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t("emailNotConfigured")}</p>
      )}
      {channel === "whatsapp" && docUrl && <p className="text-xs text-muted-foreground">{t("attachHint")}</p>}

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
        {channel === "whatsapp" ? (
          <>
            {docUrl && isMobile() && (
              <Button variant="secondary" onClick={nativeShare} disabled={pending}>
                <Share2 />
                {t("shareDevice")}
              </Button>
            )}
            <Button onClick={prepare} disabled={pending || !normalized.ok || !text.body.trim()} className="bg-[#128C7E] text-white hover:bg-[#0f7a6e]">
              {pending ? <Loader2 className="animate-spin" /> : <MessageCircle />}
              {docUrl ? t("downloadAndOpen") : target === "web" ? t("openWeb") : t("openWhatsapp")}
            </Button>
          </>
        ) : (
          <Button onClick={sendEmail} disabled={pending || !emailValid || !text.body.trim() || !text.subject.trim() || !ctx.emailConfigured}>
            {pending ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
            {t("sendEmail")}
          </Button>
        )}
      </div>
    </div>
  )
}
