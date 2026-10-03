"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import {
  Baby,
  Bell,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  FileUp,
  FlaskConical,
  HeartPulse,
  LayoutDashboard,
  Loader2,
  Settings,
  Stethoscope,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { useCan, useRefs } from "@/components/app-context"
import { globalSearch } from "@/lib/actions/patients"
import { formatDate, formatDateTime } from "@/lib/dates"
import { P } from "@/lib/permissions"

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])
  return { open, setOpen }
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Patient-scoped actions need a patient: from the current page or by picking one. */
type PatientAction = "new-visit-fertility" | "new-visit-pregnancy" | "new-visit-gynecology" | "new-oi" | "upload" | "appointment"

interface Command {
  id: string
  label: string
  icon: LucideIcon
  run: () => void
  shortcut?: string
  keywords?: string[]
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("palette")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const can = useCan()
  const refs = useRefs()
  const [query, setQuery] = useState("")
  const [pendingAction, setPendingAction] = useState<PatientAction | null>(null)
  const debounced = useDebounced(query.trim(), 250)

  const currentPatientId = pathname.match(/^\/patients\/([0-9a-f-]{36})/)?.[1] ?? null

  const search = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: async () => {
      const res = await globalSearch(debounced)
      if (!res.ok) throw new Error(res.error.code)
      return res.data
    },
    enabled: open && debounced.length >= 2,
  })

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  const patientAction = (action: PatientAction) => {
    if (currentPatientId) {
      go(`/patients/${currentPatientId}?action=${action}`)
    } else {
      setPendingAction(action)
      setQuery("")
    }
  }

  const commands = useMemo<Command[]>(() => {
    const list: (Command & { show: boolean })[] = [
      { id: "new-patient", label: t("newPatient"), icon: UserPlus, run: () => go("/patients/new"), show: can(P.patientsCreate), keywords: ["register", "add"] },
      { id: "new-appointment", label: t("newAppointment"), icon: CalendarPlus, run: () => patientAction("appointment"), show: can(P.appointmentsCreate) },
      { id: "today", label: t("today"), icon: CalendarDays, run: () => go("/appointments?tab=today"), show: can(P.appointmentsView) },
      { id: "tomorrow", label: t("tomorrow"), icon: CalendarClock, run: () => go("/appointments?tab=tomorrow"), show: can(P.appointmentsView) },
      { id: "fertility", label: t("newFertilityVisit"), icon: FlaskConical, run: () => patientAction("new-visit-fertility"), show: can(P.visitsCreate) },
      { id: "pregnancy", label: t("newPregnancyVisit"), icon: Baby, run: () => patientAction("new-visit-pregnancy"), show: can(P.visitsCreate) },
      { id: "gynecology", label: t("newGynecologyVisit"), icon: Stethoscope, run: () => patientAction("new-visit-gynecology"), show: can(P.visitsCreate) },
      { id: "oi", label: t("newOiCycle"), icon: HeartPulse, run: () => patientAction("new-oi"), show: can(P.oiEdit) },
      { id: "upload", label: t("uploadDocument"), icon: FileUp, run: () => patientAction("upload"), show: can(P.documentsUpload) },
      { id: "patients", label: t("patients"), icon: Users, run: () => go("/patients"), show: can(P.patientsView) },
      { id: "dashboard", label: t("dashboard"), icon: LayoutDashboard, run: () => go("/dashboard"), show: true },
      { id: "notifications", label: t("notifications"), icon: Bell, run: () => go("/notifications"), show: true },
      { id: "settings", label: t("settings"), icon: Settings, run: () => go("/settings"), show: true },
    ]
    return list.filter((c) => c.show)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, can, currentPatientId])

  const results = search.data
  const selectingPatient = pendingAction !== null

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
    >
      <Command shouldFilter={!selectingPatient && debounced.length < 2} className="**:data-[slot=command-input-wrapper]:h-12">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={selectingPatient ? t("pickPatient") : t("placeholder")}
      />
      <CommandList>
        <CommandEmpty>
          {search.isFetching ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("searching")}
            </span>
          ) : debounced.length >= 2 ? (
            t("noResults")
          ) : (
            t("typeToSearch")
          )}
        </CommandEmpty>

        {!selectingPatient && debounced.length < 2 && (
          <CommandGroup heading={t("actions")}>
            {commands.map((c) => (
              <CommandItem key={c.id} value={`${c.label} ${(c.keywords ?? []).join(" ")}`} onSelect={c.run}>
                <c.icon />
                {c.label}
                {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results && results.patients.length > 0 && (
          <CommandGroup heading={t("groupPatients")}>
            {results.patients.map((p) => (
              <CommandItem
                key={p.id}
                value={`patient-${p.id}`}
                onSelect={() => go(pendingAction ? `/patients/${p.id}?action=${pendingAction}` : `/patients/${p.id}`)}
              >
                <UserRound />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{p.full_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.patient_code} · {p.dob ? formatDate(p.dob) : "—"} · <span dir="ltr">{p.phone ?? "—"}</span>
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!selectingPatient && results && results.appointments.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("groupAppointments")}>
              {results.appointments.map((a) => (
                <CommandItem key={a.id} value={`appt-${a.id}`} onSelect={() => go(`/patients/${a.patient_id}?tab=appointments`)}>
                  <CalendarDays />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{a.patient_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(a.scheduled_at, locale)} · {locale === "ar" ? a.doctor_name_ar : a.doctor_name_en} ·{" "}
                      {refs.optionLabel("appointment_type", a.visit_type)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {!selectingPatient && results && results.visits.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("groupVisits")}>
              {results.visits.map((v) => (
                <CommandItem key={v.id} value={`visit-${v.id}`} onSelect={() => go(`/patients/${v.patient_id}/visits/${v.id}`)}>
                  <Stethoscope />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{v.patient_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(v.visit_date)} · {t(`visitType.${v.visit_type}`)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
