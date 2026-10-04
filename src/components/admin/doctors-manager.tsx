"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, ImageIcon, Loader2, Pencil, Plus, Power, Save, Stethoscope, Tags, Trash2, Upload, UserRound } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { NativeSelect } from "@/components/common/native-select"
import { useCan } from "@/components/app-context"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { deleteDoctor, removeDoctorPhoto, saveDoctor, saveDoctorHours, saveDoctorPrice, uploadDoctorPhoto } from "@/lib/actions/staff"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { Doctor, DoctorWorkingHours, Service } from "@/types/db"

type Option = { id: string; label: string }
type Price = { doctor_id: string; service_id: string; price_cash: number; price_insurance: number | null }
const WEEK = [6, 0, 1, 2, 3, 4, 5] // Saturday first (Jordan)

const emptyDoctor = (): Partial<Doctor> => ({ display_name_en: "", display_name_ar: "", active: true, color: "#0f766e" })

/** Doctors: profile, photo, weekly schedule, own prices; deactivate or delete when unused. */
export function DoctorsManager({
  doctors,
  departments,
  profiles,
  hours,
  prices,
  services,
  photoBase,
}: {
  doctors: Doctor[]
  departments: Option[]
  profiles: Option[]
  hours: DoctorWorkingHours[]
  prices: Price[]
  services: Pick<Service, "id" | "name_en" | "name_ar" | "price_cash" | "price_insurance" | "category" | "active">[]
  photoBase: string
}) {
  const t = useTranslations("admin.doctorProfile")
  const locale = useLocale()
  const router = useRouter()
  const { showError } = useActionError()
  const [pending, start] = useSafeTransition()
  const [editing, setEditing] = useState<Partial<Doctor> | null>(null)
  const [removing, setRemoving] = useState<Doctor | null>(null)
  const name = (d: Partial<Doctor>) => (locale === "ar" ? d.display_name_ar || d.display_name_en : d.display_name_en) ?? ""

  const toggle = (d: Doctor) =>
    start(async () => {
      const res = await saveDoctor({ ...d, active: !d.active })
      if (!res.ok) return showError(res.error)
      toast.success(d.active ? t("deactivated") : t("reactivated"))
      router.refresh()
    })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing(emptyDoctor())}>
          <Plus />
          {t("newDoctor")}
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {doctors.map((d) => {
          const own = hours.filter((h) => h.doctor_id === d.id)
          return (
            <li key={d.id} className={cn("flex gap-3 rounded-xl border bg-card p-3", !d.active && "opacity-60")}>
              <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border bg-muted" style={{ borderColor: d.color ?? undefined }}>
                {d.photo_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${photoBase}/${d.photo_path}`} alt="" className="size-full object-cover" />
                ) : (
                  <UserRound className="size-5 text-muted-foreground" />
                )}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium">{name(d)}</p>
                <p className="truncate text-xs text-muted-foreground">{[d.specialty, d.license_number].filter(Boolean).join(" · ") || "—"}</p>
                <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  <span className="rounded-full bg-muted px-2 py-0.5">{own.length ? t("ownSchedule", { count: own.length }) : t("clinicHours")}</span>
                  {!d.active && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">{t("inactive")}</span>}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Button size="icon-sm" variant="ghost" aria-label={t("edit")} onClick={() => setEditing(d)}>
                  <Pencil />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={d.active ? t("deactivate") : t("reactivate")} onClick={() => toggle(d)} disabled={pending}>
                  <Power />
                </Button>
                <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={t("delete")} onClick={() => setRemoving(d)}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {editing && (
        <DoctorSheet
          doctor={editing}
          departments={departments}
          profiles={profiles}
          hours={hours.filter((h) => h.doctor_id === editing.id)}
          prices={prices.filter((p) => p.doctor_id === editing.id)}
          services={services}
          photoBase={photoBase}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle", { name: removing ? name(removing) : "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                start(async () => {
                  const d = removing
                  setRemoving(null)
                  if (!d) return
                  const res = await deleteDoctor(d.id)
                  if (!res.ok) return res.error.code === "inUse" ? toast.error(t("inUse")) : showError(res.error)
                  toast.success(t("deleted"))
                  router.refresh()
                })
              }
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DoctorSheet({
  doctor,
  departments,
  profiles,
  hours,
  prices,
  services,
  photoBase,
  onClose,
}: {
  doctor: Partial<Doctor>
  departments: Option[]
  profiles: Option[]
  hours: DoctorWorkingHours[]
  prices: Price[]
  services: Pick<Service, "id" | "name_en" | "name_ar" | "price_cash" | "price_insurance" | "category" | "active">[]
  photoBase: string
  onClose: () => void
}) {
  const t = useTranslations("admin.doctorProfile")
  const tw = useTranslations("weekdays")
  const locale = useLocale()
  const can = useCan()
  const router = useRouter()
  const { showError, message } = useActionError()
  const [pending, start] = useSafeTransition()
  const [v, setV] = useState<Partial<Doctor>>(doctor)
  const [error, setError] = useState<string | null>(null)
  const [schedule, setSchedule] = useState(
    hours.map((h) => ({ weekday: h.weekday, start_time: h.start_time.slice(0, 5), end_time: h.end_time.slice(0, 5) })),
  )
  const [own, setOwn] = useState(() => Object.fromEntries(prices.map((p) => [p.service_id, { cash: String(p.price_cash), ins: p.price_insurance == null ? "" : String(p.price_insurance) }])))
  const photo = useRef<HTMLInputElement>(null)
  const field = (k: keyof Doctor, label: string, dir: "ltr" | "rtl" | "auto" = "auto", type = "text") => (
    <div className="grid gap-1">
      <Label htmlFor={`dr-${k}`}>{label}</Label>
      <Input id={`dr-${k}`} type={type} dir={dir} value={(v[k] as string | null) ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </div>
  )

  const saveProfile = () =>
    start(async () => {
      setError(null)
      const res = await saveDoctor({
        id: v.id ?? null,
        display_name_en: v.display_name_en ?? "",
        display_name_ar: v.display_name_ar ?? null,
        specialty: v.specialty ?? null,
        title_en: v.title_en ?? null,
        title_ar: v.title_ar ?? null,
        department_id: v.department_id || null,
        profile_id: v.profile_id || null,
        phone: v.phone ?? null,
        email: v.email ?? "",
        license_number: v.license_number ?? null,
        color: v.color || null,
        active: v.active ?? true,
      })
      if (!res.ok) return setError(message(res.error, "saveDoctor"))
      setV({ ...v, id: res.data.id })
      toast.success(t("saved"))
      router.refresh()
    })

  const saveSchedule = () =>
    start(async () => {
      if (!v.id) return
      const res = await saveDoctorHours(v.id, schedule)
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })

  const savePrice = (serviceId: string) =>
    start(async () => {
      if (!v.id) return
      const p = own[serviceId] ?? { cash: "", ins: "" }
      const res = await saveDoctorPrice({
        doctorId: v.id,
        serviceId,
        priceCash: p.cash === "" ? null : Number(p.cash),
        priceInsurance: p.ins === "" ? null : Number(p.ins),
      })
      if (!res.ok) return showError(res.error)
      toast.success(t("saved"))
      router.refresh()
    })

  const uploadPhoto = (file?: File) =>
    file &&
    v.id &&
    start(async () => {
      const fd = new FormData()
      fd.set("doctorId", v.id!)
      fd.set("file", file)
      const res = await uploadDoctorPhoto(fd)
      if (photo.current) photo.current.value = ""
      if (!res.ok) return showError(res.error)
      toast.success(t("photoSaved"))
      router.refresh()
    })

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Stethoscope className="size-5 text-primary" />
            {v.id ? (locale === "ar" ? v.display_name_ar || v.display_name_en : v.display_name_en) : t("newDoctor")}
          </SheetTitle>
          <SheetDescription>{t("hint")}</SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="profile" className="px-4 pb-6">
          <TabsList className="w-full">
            <TabsTrigger value="profile">{t("tabProfile")}</TabsTrigger>
            <TabsTrigger value="schedule" disabled={!v.id}>
              <CalendarClock className="size-3.5" />
              {t("tabSchedule")}
            </TabsTrigger>
            <TabsTrigger value="prices" disabled={!v.id || !can(P.pricingManage)}>
              <Tags className="size-3.5" />
              {t("tabPrices")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-4 space-y-4">
            {v.id && (
              <div className="flex items-center gap-3">
                <span className="grid size-16 place-items-center overflow-hidden rounded-full border bg-muted">
                  {doctor.photo_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${photoBase}/${doctor.photo_path}`} alt="" className="size-full object-cover" />
                  ) : (
                    <ImageIcon className="size-6 text-muted-foreground" />
                  )}
                </span>
                <input ref={photo} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                <Button size="sm" variant="outline" onClick={() => photo.current?.click()} disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" /> : <Upload />}
                  {t("photo")}
                </Button>
                {doctor.photo_path && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() =>
                      start(async () => {
                        const res = await removeDoctorPhoto(v.id!)
                        if (!res.ok) return showError(res.error)
                        router.refresh()
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {field("display_name_en", t("nameEn"), "ltr")}
              {field("display_name_ar", t("nameAr"), "rtl")}
              {field("title_en", t("titleEn"), "ltr")}
              {field("title_ar", t("titleAr"), "rtl")}
              {field("specialty", t("specialty"))}
              {field("license_number", t("license"), "ltr")}
              {field("phone", t("phone"), "ltr", "tel")}
              {field("email", t("email"), "ltr", "email")}
              <div className="grid gap-1">
                <Label htmlFor="dr-dept">{t("department")}</Label>
                <NativeSelect id="dr-dept" value={v.department_id ?? ""} onChange={(e) => setV({ ...v, department_id: e.target.value || null })}>
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="dr-login">{t("loginAccount")}</Label>
                <NativeSelect id="dr-login" value={v.profile_id ?? ""} onChange={(e) => setV({ ...v, profile_id: e.target.value || null })}>
                  <option value="">—</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="dr-color">{t("color")}</Label>
                <Input id="dr-color" type="color" value={v.color ?? "#0f766e"} onChange={(e) => setV({ ...v, color: e.target.value })} className="h-9 w-20 p-1" />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Switch checked={v.active ?? true} onCheckedChange={(c) => setV({ ...v, active: c })} />
                {t("active")}
              </label>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={saveProfile} disabled={pending || !v.display_name_en?.trim()}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />}
              {t("save")}
            </Button>
          </TabsContent>

          <TabsContent value="schedule" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">{t("scheduleHint")}</p>
            <ul className="divide-y rounded-lg border">
              {WEEK.map((day) => {
                const rows = schedule.map((r, i) => ({ ...r, i })).filter((r) => r.weekday === day)
                return (
                  <li key={day} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                    <span className="w-24 shrink-0 font-medium">{tw(String(day))}</span>
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                      {rows.length === 0 && <span className="text-xs text-muted-foreground">{t("dayOff")}</span>}
                      {rows.map((r) => (
                        <span key={r.i} className="flex items-center gap-1">
                          <Input type="time" className="h-8 w-28" value={r.start_time} onChange={(e) => setSchedule(schedule.map((x, j) => (j === r.i ? { ...x, start_time: e.target.value } : x)))} />
                          –
                          <Input type="time" className="h-8 w-28" value={r.end_time} onChange={(e) => setSchedule(schedule.map((x, j) => (j === r.i ? { ...x, end_time: e.target.value } : x)))} />
                          <Button size="icon-xs" variant="ghost" aria-label={t("remove")} onClick={() => setSchedule(schedule.filter((_, j) => j !== r.i))}>
                            <Trash2 />
                          </Button>
                        </span>
                      ))}
                    </div>
                    <Button size="xs" variant="outline" onClick={() => setSchedule([...schedule, { weekday: day, start_time: "09:00", end_time: "14:00" }])}>
                      <Plus />
                      {t("addShift")}
                    </Button>
                  </li>
                )
              })}
            </ul>
            <Button onClick={saveSchedule} disabled={pending || schedule.some((r) => r.end_time <= r.start_time)}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />}
              {t("saveSchedule")}
            </Button>
          </TabsContent>

          <TabsContent value="prices" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">{t("pricesHint")}</p>
            <ul className="divide-y rounded-lg border">
              {services
                .filter((s) => s.active && s.category !== "package" && s.category !== "registration")
                .map((s) => {
                  const p = own[s.id] ?? { cash: "", ins: "" }
                  return (
                    <li key={s.id} className="grid gap-2 p-2 text-sm sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-center">
                      <span>
                        {locale === "ar" ? s.name_ar : s.name_en}
                        <span className="block text-xs text-muted-foreground" dir="ltr">
                          {t("catalog")}: {Number(s.price_cash).toFixed(3)}
                          {s.price_insurance != null ? ` / ${Number(s.price_insurance).toFixed(3)}` : ""}
                        </span>
                      </span>
                      <Input type="number" inputMode="decimal" min={0} step="0.001" dir="ltr" placeholder={t("cash")} value={p.cash} onChange={(e) => setOwn({ ...own, [s.id]: { ...p, cash: e.target.value } })} />
                      <Input type="number" inputMode="decimal" min={0} step="0.001" dir="ltr" placeholder={t("insurance")} value={p.ins} onChange={(e) => setOwn({ ...own, [s.id]: { ...p, ins: e.target.value } })} />
                      <Button size="sm" variant="secondary" onClick={() => savePrice(s.id)} disabled={pending}>
                        <Save />
                        {t("save")}
                      </Button>
                    </li>
                  )
                })}
            </ul>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
