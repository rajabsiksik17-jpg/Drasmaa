"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize, hasPermission } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { clinicDateTimeToIso, clinicDayRange } from "@/lib/dates"
import type { AppointmentStatus } from "@/types/db"

const appointmentSchema = z.object({
  patient_id: z.uuid(),
  doctor_id: z.uuid(),
  department_id: z.uuid(),
  visit_type: z.string().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes: z.number().int().min(5).max(480),
  notes: z.string().max(1000).optional().nullable(),
  payment_method: z.enum(["cash", "insurance"]).optional().nullable(),
  insurance_company_id: z.uuid().optional().nullable(),
  source_visit_id: z.uuid().optional().nullable(),
  service_id: z.uuid().optional().nullable(),
  no_charge: z.boolean().optional(),
  /** Explicit decision to book outside the working hours (permission + flag). */
  outside_working_hours: z.boolean().optional(),
})

export type AppointmentInput = z.input<typeof appointmentSchema>

function revalidateAppointments(patientId?: string) {
  revalidatePath("/appointments")
  revalidatePath("/dashboard")
  if (patientId) revalidatePath(`/patients/${patientId}`)
}

export async function createAppointment(input: AppointmentInput): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.appointmentsCreate)
  if (auth.error) return auth.error
  const parsed = appointmentSchema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => i.path.join(".")))
  const { date, time, ...rest } = parsed.data
  if (rest.payment_method === "insurance" && !rest.insurance_company_id) {
    return fail("validation", ["insurance_company_id"])
  }
  if (rest.outside_working_hours && !hasPermission(auth.session, P.appointmentsOutsideHours)) return fail("forbidden")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      ...rest,
      notes: rest.notes?.trim() || null,
      insurance_company_id: rest.payment_method === "insurance" ? rest.insurance_company_id : null,
      scheduled_at: clinicDateTimeToIso(date, time),
    })
    .select("id")
    .single()
  if (error) return dbFail("createAppointment", error)
  revalidateAppointments(rest.patient_id)
  return ok(data)
}

const TRANSITION_PERMISSION: Record<AppointmentStatus, (typeof P)[keyof typeof P]> = {
  scheduled: P.appointmentsCheckin,
  checked_in: P.appointmentsCheckin,
  with_doctor: P.appointmentsEdit,
  completed: P.appointmentsEdit,
  cancelled: P.appointmentsCancel,
  no_show: P.appointmentsCancel,
  rescheduled: P.appointmentsEdit,
}

export async function setAppointmentStatus(input: {
  id: string
  status: Exclude<AppointmentStatus, "rescheduled">
  expectedVersion: number
  reason?: string | null
}): Promise<ActionResult<{ version: number; status: AppointmentStatus }>> {
  const auth = await authorize()
  if (auth.error) return auth.error
  const needed = TRANSITION_PERMISSION[input.status]
  if (!needed || !hasPermission(auth.session, needed)) return fail("forbidden")
  if (!z.uuid().safeParse(input.id).success) return fail("validation")

  const supabase = await createClient({ auditReason: input.reason })
  const patch: Record<string, unknown> = { status: input.status }
  if (input.status === "cancelled" && input.reason) patch.cancel_reason = input.reason.slice(0, 500)

  const { data, error } = await supabase
    .from("appointments")
    .update(patch)
    .eq("id", input.id)
    .eq("version", input.expectedVersion)
    .select("version, status, patient_id")
    .maybeSingle()
  if (error) return dbFail("setAppointmentStatus", error)
  if (!data) {
    const { data: current } = await supabase.from("appointments").select("version").eq("id", input.id).maybeSingle()
    return fail(current ? "conflict" : "notFound")
  }
  revalidateAppointments(data.patient_id)
  return ok({ version: data.version, status: data.status })
}

/** Busy intervals of a doctor on a clinic-local day (for slot picking). */
export async function getBusySlots(doctorId: string, date: string): Promise<ActionResult<{ start: string; end: string; status: string }[]>> {
  const auth = await authorize(P.appointmentsView)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(doctorId).success || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("validation")
  const range = clinicDayRange(date)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("appointments")
    .select("scheduled_at, ends_at, status")
    .eq("doctor_id", doctorId)
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", range.end)
    .in("status", ["scheduled", "checked_in", "with_doctor", "completed"])
  if (error) return dbFail("getBusySlots", error)
  return ok((data ?? []).map((r) => ({ start: r.scheduled_at, end: r.ends_at, status: r.status })))
}

export interface PatientDefaults {
  payment_method: "cash" | "insurance"
  insurance_company_id: string | null
  assigned_doctor_id: string | null
}

export async function getPatientPaymentDefaults(patientId: string): Promise<ActionResult<PatientDefaults>> {
  const auth = await authorize(P.appointmentsCreate)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(patientId).success) return fail("validation")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("patients")
    .select("payment_method, insurance_company_id, assigned_doctor_id")
    .eq("id", patientId)
    .maybeSingle()
  if (error) return dbFail("getPatientPaymentDefaults", error)
  if (!data) return fail("notFound")
  return ok(data as PatientDefaults)
}

export async function rescheduleAppointment(input: {
  id: string
  date: string
  time: string
  doctor_id?: string | null
  duration_minutes?: number | null
  notes?: string | null
  outside_working_hours?: boolean
}): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(P.appointmentsEdit)
  if (auth.error) return auth.error
  const schema = z.object({
    id: z.uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    doctor_id: z.uuid().nullable().optional(),
    duration_minutes: z.number().int().min(5).max(480).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    outside_working_hours: z.boolean().optional(),
  })
  const parsed = schema.safeParse(input)
  if (!parsed.success) return fail("validation", parsed.error.issues.map((i) => i.path.join(".")))
  const v = parsed.data
  if (v.outside_working_hours && !hasPermission(auth.session, P.appointmentsOutsideHours)) return fail("forbidden")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("reschedule_appointment", {
    p_appointment_id: v.id,
    p_scheduled_at: clinicDateTimeToIso(v.date, v.time),
    p_doctor_id: v.doctor_id ?? null,
    p_duration_minutes: v.duration_minutes ?? null,
    p_notes: v.notes ?? null,
    p_outside_working_hours: !!v.outside_working_hours,
  })
  if (error) return dbFail("rescheduleAppointment", error)
  revalidateAppointments()
  return ok({ id: data as string })
}
