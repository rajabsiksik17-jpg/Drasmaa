import "server-only"
import { createClient } from "@/lib/supabase/server"
import { addDaysIso, clinicDayRange, clinicToday } from "@/lib/dates"
import type { AppointmentStatus, AppointmentWithRefs, EncounterStatus, InvoiceStatus } from "@/types/db"

export const APPOINTMENT_SELECT =
  "*, patient:patients(id, full_name, patient_code, phone, dob), doctor:doctors(id, display_name_en, display_name_ar, color), department:departments(id, code, name_en, name_ar)"

export interface AppointmentQuery {
  from?: string
  to?: string
  doctorId?: string | null
  departmentId?: string | null
  patientId?: string | null
  visitType?: string | null
  statuses?: AppointmentStatus[]
  ascending?: boolean
  limit?: number
  offset?: number
}

export async function getAppointments(q: AppointmentQuery): Promise<{ rows: AppointmentWithRefs[]; total: number }> {
  const supabase = await createClient()
  let query = supabase.from("appointments").select(APPOINTMENT_SELECT, { count: "exact" })
  if (q.from) query = query.gte("scheduled_at", q.from)
  if (q.to) query = query.lt("scheduled_at", q.to)
  if (q.doctorId) query = query.eq("doctor_id", q.doctorId)
  if (q.departmentId) query = query.eq("department_id", q.departmentId)
  if (q.patientId) query = query.eq("patient_id", q.patientId)
  if (q.visitType) query = query.eq("visit_type", q.visitType)
  if (q.statuses?.length) query = query.in("status", q.statuses)
  query = query.order("scheduled_at", { ascending: q.ascending ?? true })
  const limit = q.limit ?? 100
  const offset = q.offset ?? 0
  const { data, count, error } = await query.range(offset, offset + limit - 1)
  if (error) {
    console.error(`[db] getAppointments: ${error.code}`)
    return { rows: [], total: 0 }
  }
  const rows = (data ?? []) as AppointmentWithRefs[]
  // What each appointment became (arrival, visit, payment) — one query for the page.
  const ids = rows.filter((r) => r.status !== "scheduled" && r.status !== "cancelled" && r.status !== "rescheduled").map((r) => r.id)
  if (ids.length) {
    const { data: enc, error: encError } = await supabase
      .from("encounters")
      .select("appointment_id, status, arrived_at, invoices(status, balance_patient)")
      .in("appointment_id", ids)
    if (encError) console.error(`[db] getAppointments encounters: ${encError.code}`)
    const byAppt = new Map((enc ?? []).map((e) => [e.appointment_id as string, e]))
    for (const r of rows) {
      const e = byAppt.get(r.id) as
        | { status: EncounterStatus; arrived_at: string; invoices: { status: InvoiceStatus; balance_patient: number }[] | null }
        | undefined
      if (!e) continue
      const inv = (e.invoices ?? []).find((i) => i.status !== "void")
      r.visit = { status: e.status, arrived_at: e.arrived_at, paid: inv ? inv.status === "paid" || inv.status === "no_charge" || Number(inv.balance_patient) <= 0 : null, balance: inv ? Number(inv.balance_patient) : null }
    }
  }
  return { rows, total: count ?? 0 }
}

export function dayWindow(offsetDays = 0) {
  return clinicDayRange(addDaysIso(clinicToday(), offsetDays))
}

export interface AppointmentCounts {
  today_total: number
  scheduled: number
  waiting: number
  with_doctor: number
  completed: number
  no_show: number
  cancelled: number
  tomorrow: number
}

export async function getAppointmentCounts(doctorId?: string | null): Promise<AppointmentCounts> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("appointment_counts", { p_day: clinicToday(), p_doctor: doctorId ?? null })
  return {
    today_total: 0,
    scheduled: 0,
    waiting: 0,
    with_doctor: 0,
    completed: 0,
    no_show: 0,
    cancelled: 0,
    tomorrow: 0,
    ...((data as Partial<AppointmentCounts>) ?? {}),
  }
}
