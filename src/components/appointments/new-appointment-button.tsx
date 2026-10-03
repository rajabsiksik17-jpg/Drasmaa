"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CalendarPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppointmentDialog } from "@/components/appointments/appointment-dialog"
import type { PickedPatient } from "@/components/patients/patient-picker"
import { useCan } from "@/components/app-context"
import { P } from "@/lib/permissions"

export function NewAppointmentButton({
  patient,
  variant = "default",
  size = "default",
  label,
  sourceVisitId,
  defaultDoctorId,
}: {
  patient?: PickedPatient | null
  variant?: "default" | "outline" | "secondary" | "ghost"
  size?: "default" | "sm" | "lg"
  label?: string
  sourceVisitId?: string | null
  defaultDoctorId?: string | null
}) {
  const t = useTranslations("appointments")
  const can = useCan()
  const [open, setOpen] = useState(false)
  if (!can(P.appointmentsCreate)) return null
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <CalendarPlus />
        {label ?? t("new")}
      </Button>
      {open && (
        <AppointmentDialog
          open={open}
          onOpenChange={setOpen}
          patient={patient}
          sourceVisitId={sourceVisitId}
          defaults={defaultDoctorId ? { doctor_id: defaultDoctorId } : undefined}
        />
      )}
    </>
  )
}
