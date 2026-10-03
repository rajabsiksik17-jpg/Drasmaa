"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { motion } from "motion/react"
import { CalendarPlus, ExternalLink, MoreHorizontal, Search, UserRound, Users } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/common/page"
import { InlineEdit } from "@/components/forms/inline-edit"
import { AppointmentDialog } from "@/components/appointments/appointment-dialog"
import { useCan } from "@/components/app-context"
import { ageFromDob, formatDate } from "@/lib/dates"
import { P } from "@/lib/permissions"
import { cn } from "@/lib/utils"

interface Row {
  id: string
  patient_code: string
  full_name: string
  dob: string | null
  phone: string | null
  status: string
  version: number
}

export function PatientSearchBox({ initial }: { initial: string }) {
  const t = useTranslations("patients")
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const id = setTimeout(() => {
      if (value === (params.get("q") ?? "")) return
      const next = new URLSearchParams(params)
      if (value) next.set("q", value)
      else next.delete("q")
      next.delete("page")
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    }, 300)
    return () => clearTimeout(id)
  }, [value, params, pathname, router])
  return (
    <div className="relative max-w-xl">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("searchPlaceholder")}
        className="h-10 ps-9"
        aria-label={t("searchPlaceholder")}
        autoFocus
      />
    </div>
  )
}

export function PatientsTable({ rows, query }: { rows: Row[]; query: string }) {
  const t = useTranslations("patients")
  const can = useCan()
  const [booking, setBooking] = useState<Row | null>(null)

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={query ? t("noResults") : t("empty")}
        description={query ? t("noResultsHint") : undefined}
        action={
          can(P.patientsCreate) ? (
            <Button asChild size="sm">
              <Link href={`/patients/new${query ? `?name=${encodeURIComponent(query)}` : ""}`}>{t("new")}</Link>
            </Button>
          ) : undefined
        }
      />
    )
  }
  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("patient")}</th>
              <th className="hidden px-4 py-2.5 text-start font-medium sm:table-cell">{t("dob")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("phone")}</th>
              <th className="w-px px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <motion.tr
                key={r.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.015, 0.2) }}
                className={cn("border-t hover:bg-muted/30", r.status === "archived" && "opacity-60")}
              >
                <td className="px-4 py-2.5">
                  <Link href={`/patients/${r.id}`} className="font-medium hover:text-primary hover:underline">
                    {r.full_name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{r.patient_code}</span>
                    {r.status === "archived" && ` · ${t("archived")}`}
                    <span className="sm:hidden">{r.dob ? ` · ${ageFromDob(r.dob)}y` : ""}</span>
                  </div>
                </td>
                <td className="hidden px-4 py-2.5 sm:table-cell">
                  {r.dob ? `${formatDate(r.dob)} · ${t("age", { age: ageFromDob(r.dob) ?? "—" })}` : "—"}
                </td>
                <td className="px-4 py-2.5" dir="ltr">
                  <InlineEdit
                    table="patients"
                    recordKey={r.id}
                    field="phone"
                    version={r.version}
                    value={r.phone}
                    type="tel"
                    label={t("phone")}
                    canEdit={can(P.patientsEdit)}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/patients/${r.id}`}>
                        <ExternalLink />
                        <span className="sr-only sm:not-sr-only">{t("open")}</span>
                      </Link>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={t("more")}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {can(P.appointmentsCreate) && (
                          <DropdownMenuItem onSelect={() => setBooking(r)}>
                            <CalendarPlus />
                            {t("bookAppointment")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem asChild>
                          <Link href={`/patients/${r.id}?tab=personal`}>
                            <UserRound />
                            {t("edit")}
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      {booking && (
        <AppointmentDialog
          open
          onOpenChange={(o) => !o && setBooking(null)}
          patient={{ id: booking.id, full_name: booking.full_name, patient_code: booking.patient_code }}
        />
      )}
    </>
  )
}
