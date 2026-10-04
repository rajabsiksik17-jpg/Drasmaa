import "server-only"
import { createClient } from "@/lib/supabase/server"
import { logDbError } from "@/lib/errors"
import { clinicToday } from "@/lib/dates"
import type { Encounter, EncounterStatus, InvoiceStatus, Patient, VisitStatus, VisitType } from "@/types/db"

export interface QueueEncounter extends Encounter {
  patient: Pick<Patient, "id" | "full_name" | "patient_code" | "dob" | "phone"> | null
  invoices: { id: string; invoice_number: string; total: number; balance_patient: number; status: InvoiceStatus }[]
  visits: { id: string; visit_type: VisitType; status: VisitStatus }[]
  appointment: { scheduled_at: string } | null
}

const SELECT =
  "*, patient:patients(id, full_name, patient_code, dob, phone), invoices(id, invoice_number, total, balance_patient, status), visits(id, visit_type, status), appointment:appointments(scheduled_at)"

/** Today's clinic visits (the real queue), oldest arrival first. RLS applies. */
export async function getTodayQueue(opts: { doctorId?: string | null; statuses?: EncounterStatus[] } = {}): Promise<{ rows: QueueEncounter[]; error: boolean }> {
  const supabase = await createClient()
  let query = supabase.from("encounters").select(SELECT).eq("queue_date", clinicToday()).order("arrived_at")
  if (opts.doctorId) query = query.or(`doctor_id.eq.${opts.doctorId},doctor_id.is.null`)
  if (opts.statuses?.length) query = query.in("status", opts.statuses)
  const { data, error } = await query.limit(300)
  if (error) {
    logDbError("getTodayQueue", error)
    return { rows: [], error: true }
  }
  return { rows: ((data ?? []) as QueueEncounter[]).map(withLiveInvoice), error: false }
}

/** Open clinic visit of a patient today (header actions), if any. */
export async function getOpenEncounter(patientId: string): Promise<QueueEncounter | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("encounters")
    .select(SELECT)
    .eq("patient_id", patientId)
    .eq("queue_date", clinicToday())
    .not("status", "in", "(checked_out,cancelled)")
    .order("arrived_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    logDbError("getOpenEncounter", error)
    return null
  }
  return data ? withLiveInvoice(data as QueueEncounter) : null
}

function withLiveInvoice(e: QueueEncounter): QueueEncounter {
  return { ...e, invoices: (e.invoices ?? []).filter((i) => i.status !== "void"), visits: e.visits ?? [] }
}
