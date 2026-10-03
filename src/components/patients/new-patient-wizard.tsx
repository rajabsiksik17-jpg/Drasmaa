"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { AnimatePresence, motion } from "motion/react"
import { ArrowLeft, ArrowRight, CheckCircle2, HeartHandshake, Loader2, Search, Stethoscope, UserPlus, UserRound, Users, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/common/native-select"
import { DateInput } from "@/components/common/date-input"
import { SectionCard } from "@/components/common/page"
import { useRefs } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { createPatient, findDuplicates, type DuplicateCandidate } from "@/lib/actions/patients"
import { newPatientSchema, type NewPatientInput, type NewPatientOutput } from "@/lib/validation/patient"
import { ageFromDob, clinicToday, formatDate } from "@/lib/dates"
import { cn } from "@/lib/utils"

type Step = "check" | "matches" | "form"

export function NewPatientWizard({ initialName }: { initialName: string }) {
  const t = useTranslations("newPatient")
  const tc = useTranslations("common")
  const refs = useRefs()
  const router = useRouter()
  const { message } = useActionError()
  const [step, setStep] = useState<Step>("check")
  const [matches, setMatches] = useState<DuplicateCandidate[]>([])
  const [checking, startCheck] = useTransition()
  const [saving, startSave] = useTransition()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<NewPatientInput, unknown, NewPatientOutput>({
    resolver: zodResolver(newPatientSchema),
    defaultValues: {
      full_name: initialName,
      phone: "",
      dob: "",
      occupation: "",
      address: "",
      marriage_date: "",
      blood_group: null,
      rh: null,
      husband: { full_name: "", dob: "", occupation: "", blood_group: null, rh: null },
      payment_method: "cash",
      insurance_company_id: "",
      assigned_doctor_id: "",
    },
  })
  const [dob, husbandDob, payment] = useWatch({ control: form.control, name: ["dob", "husband.dob", "payment_method"] })
  const err = form.formState.errors

  const check = () =>
    startCheck(async () => {
      setFormError(null)
      const ok = await form.trigger(["full_name", "phone"])
      if (!ok) return
      const v = form.getValues()
      const res = await findDuplicates({ name: v.full_name, phone: v.phone, dob: v.dob || null })
      if (!res.ok) {
        toast.error(message(res.error))
        return
      }
      setMatches(res.data)
      setStep(res.data.length ? "matches" : "form")
    })

  // Doctor assignment preview (the database applies the same rule on insert).
  const activeDoctors = refs.activeDoctors()
  const onlyDoctor = activeDoctors.length === 1 ? activeDoctors[0] : null

  // Guards against double submission before `saving` becomes true.
  const submitting = useRef(false)
  // Validate on the client, then send the raw input (the server re-validates it).
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting.current) return
    submitting.current = true
    void form.handleSubmit(save, () => {
      submitting.current = false
    })(e)
  }
  const save = () => {
    startSave(async () => {
      setFormError(null)
      try {
        const res = await createPatient(form.getValues())
        if (!res.ok) {
          setFormError(res.error.code === "unexpected" ? t("createFailed") : message(res.error))
          submitting.current = false
          return
        }
        toast.success(t("created", { code: res.data.patient_code }))
        router.push(`/patients/${res.data.id}`)
      } catch {
        setFormError(t("createFailed"))
        submitting.current = false
      }
    })
  }

  // All registration dates: typed DD/MM/YYYY or picked; stored as ISO yyyy-MM-dd.
  const [today] = useState(clinicToday)
  const dateField = (name: "dob" | "marriage_date" | "husband.dob", id: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <>
          <DateInput
            id={id}
            value={(field.value as string | null | undefined) || null}
            max={today}
            invalid={!!fieldState.error}
            onChange={(v) => field.onChange(v ?? "")}
            onBlur={field.onBlur}
          />
          {fieldState.error?.message && <p className="text-xs text-destructive">{tc(fieldState.error.message as "required")}</p>}
        </>
      )}
    />
  )

  const fieldError = (msg?: string) => (msg ? <p className="text-xs text-destructive">{tc(msg as "required")}</p> : null)
  const bloodSelect = (name: "blood_group" | "husband.blood_group", rhName: "rh" | "husband.rh", id: string) => (
    <div className="grid grid-cols-2 gap-2">
      <NativeSelect id={id} {...form.register(name, { setValueAs: (v) => v || null })}>
        <option value="">{t("bloodGroup")}</option>
        {["A", "B", "AB", "O"].map((g) => (
          <option key={g} value={g}>{g}</option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Rh" {...form.register(rhName, { setValueAs: (v) => v || null })}>
        <option value="">Rh</option>
        <option value="+">Rh +</option>
        <option value="-">Rh −</option>
      </NativeSelect>
    </div>
  )

  return (
    <div className="space-y-5">
      <ol className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {(["check", "form"] as const).map((s, i) => {
          const active = step === s || (s === "check" && step === "matches")
          const done = s === "check" && step === "form"
          return (
            <li key={s} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-8 bg-border" />}
              <span className={cn("grid size-6 place-items-center rounded-full border", active && "border-primary bg-primary text-primary-foreground", done && "border-success bg-success text-white")}>
                {done ? <CheckCircle2 className="size-3.5" /> : i + 1}
              </span>
              <span className={cn(active && "text-foreground")}>{t(`step.${s}`)}</span>
            </li>
          )
        })}
      </ol>

      <AnimatePresence mode="wait">
        {step !== "form" ? (
          <motion.div key="check" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <SectionCard title={t("findFirst")} icon={Search}>
              <p className="mb-4 text-sm text-muted-foreground">{t("findFirstHint")}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="np-name">{t("fullName")} *</Label>
                  <Input id="np-name" {...form.register("full_name")} aria-invalid={!!err.full_name} autoFocus />
                  {fieldError(err.full_name?.message)}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="np-phone">{t("phone")} *</Label>
                  <Input id="np-phone" type="tel" dir="ltr" {...form.register("phone")} aria-invalid={!!err.phone} />
                  {fieldError(err.phone?.message)}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="np-dob">{t("dob")}</Label>
                  {dateField("dob", "np-dob")}
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={check} disabled={checking}>
                  {checking ? <Loader2 className="animate-spin" /> : <Search />}
                  {t("checkExisting")}
                </Button>
              </div>
            </SectionCard>

            {step === "matches" && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <SectionCard title={t("possibleMatches")} icon={Users} className="border-warning/50">
                  <p className="mb-3 text-sm text-muted-foreground">{t("possibleMatchesHint")}</p>
                  <ul className="divide-y rounded-lg border">
                    {matches.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <UserRound className="size-5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{m.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {m.patient_code} · {t("dob")}: {m.dob ? formatDate(m.dob) : "—"} · <span dir="ltr">{m.phone ?? "—"}</span>
                          </p>
                          <p className="mt-0.5 flex gap-1">
                            {m.reasons.map((r) => (
                              <span key={r} className="rounded bg-warning/15 px-1.5 text-[11px] font-medium">
                                {t(`reason.${r}`)}
                              </span>
                            ))}
                          </p>
                        </div>
                        <Button size="sm" asChild>
                          <Link href={`/patients/${m.id}`}>{t("openPatient")}</Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex justify-end">
                    <Button variant="outline" onClick={() => setStep("form")}>
                      <UserPlus />
                      {t("thisIsNew")}
                    </Button>
                  </div>
                </SectionCard>
              </motion.div>
            )}
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={submit} noValidate initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <SectionCard title={t("wife")} icon={UserRound}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="f-name">{t("fullName")} *</Label>
                  <Input id="f-name" {...form.register("full_name")} aria-invalid={!!err.full_name} />
                  {fieldError(err.full_name?.message)}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="f-dob">
                    {t("dob")}
                    {dob && <span className="ms-2 font-normal text-muted-foreground">{t("ageCalc", { age: ageFromDob(dob) ?? "—" })}</span>}
                  </Label>
                  {dateField("dob", "f-dob")}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="f-phone">{t("phone")} *</Label>
                  <Input id="f-phone" type="tel" dir="ltr" {...form.register("phone")} aria-invalid={!!err.phone} />
                  {fieldError(err.phone?.message)}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="f-occ">{t("occupation")}</Label>
                  <Input id="f-occ" {...form.register("occupation")} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="f-address">{t("address")}</Label>
                  <Input id="f-address" {...form.register("address")} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="f-marriage">{t("marriageDate")}</Label>
                  {dateField("marriage_date", "f-marriage")}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="f-blood">{t("bloodGroup")}</Label>
                  {bloodSelect("blood_group", "rh", "f-blood")}
                </div>
              </div>
            </SectionCard>

            <SectionCard title={t("husband")} icon={HeartHandshake}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="h-name">{t("fullName")}</Label>
                  <Input id="h-name" {...form.register("husband.full_name")} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="h-dob">
                    {t("dob")}
                    {husbandDob && <span className="ms-2 font-normal text-muted-foreground">{t("ageCalc", { age: ageFromDob(husbandDob) ?? "—" })}</span>}
                  </Label>
                  {dateField("husband.dob", "h-dob")}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="h-occ">{t("occupation")}</Label>
                  <Input id="h-occ" {...form.register("husband.occupation")} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="h-blood">{t("bloodGroup")}</Label>
                  {bloodSelect("husband.blood_group", "husband.rh", "h-blood")}
                </div>
              </div>
            </SectionCard>

            <SectionCard title={t("doctor")} icon={Stethoscope}>
              {onlyDoctor ? (
                <p className="text-sm">
                  <span className="font-medium">{onlyDoctor.label}</span>
                  <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t("doctorAuto")}</span>
                </p>
              ) : activeDoctors.length > 1 ? (
                <div className="grid max-w-sm gap-1.5">
                  <Label htmlFor="f-doctor">{t("assignedDoctor")}</Label>
                  <NativeSelect id="f-doctor" {...form.register("assigned_doctor_id")}>
                    <option value="">{t("noDoctor")}</option>
                    {activeDoctors.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </NativeSelect>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("noActiveDoctor")}</p>
              )}
            </SectionCard>

            <SectionCard title={t("payment")} icon={Wallet}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>{t("paymentMethod")}</Label>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup">
                    {(["cash", "insurance"] as const).map((m) => (
                      <label
                        key={m}
                        className={cn(
                          "flex h-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium transition",
                          payment === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                        )}
                      >
                        <input type="radio" value={m} className="sr-only" {...form.register("payment_method")} />
                        {t(m)}
                      </label>
                    ))}
                  </div>
                </div>
                <AnimatePresence>
                  {payment === "insurance" && (
                    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="grid gap-1.5">
                      <Label htmlFor="f-ins">{t("insuranceCompany")} *</Label>
                      <NativeSelect id="f-ins" {...form.register("insurance_company_id")} invalid={!!err.insurance_company_id}>
                        <option value="">{tc("select")}</option>
                        {refs.activeInsurance().map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </NativeSelect>
                      {fieldError(err.insurance_company_id?.message)}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </SectionCard>

            {formError && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("check")}>
                <ArrowLeft className="rtl:-scale-x-100" />
                {tc("back")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <ArrowRight className="rtl:-scale-x-100" />}
                {t("create")}
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
