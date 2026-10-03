import "server-only"
import { createClient } from "@/lib/supabase/server"
import type { Invoice, InvoiceLine, Payment } from "@/types/db"

export interface InvoiceBundle {
  invoice: Invoice
  lines: InvoiceLine[]
  payments: Payment[]
  patient: { id: string; full_name: string; patient_code: string; dob: string | null; phone: string | null; assigned_doctor_id: string | null }
  insurance: { name_en: string; name_ar: string } | null
  doctor: { id: string; display_name_en: string; display_name_ar: string | null } | null
  appointment: { id: string; scheduled_at: string; visit_type: string } | null
  receivers: Record<string, string>
}

export async function getInvoiceBundle(id: string): Promise<InvoiceBundle | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const supabase = await createClient()
  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle()
  if (!invoice) return null
  const inv = invoice as Invoice
  const [lines, payments, patient, insurance, doctor, appointment, profiles] = await Promise.all([
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sort_order"),
    supabase.from("payments").select("*").eq("invoice_id", id).order("received_at"),
    supabase.from("patients").select("id, full_name, patient_code, dob, phone, assigned_doctor_id").eq("id", inv.patient_id).maybeSingle(),
    inv.insurance_company_id ? supabase.from("insurance_companies").select("name_en, name_ar").eq("id", inv.insurance_company_id).maybeSingle() : Promise.resolve({ data: null }),
    inv.doctor_id ? supabase.from("doctors").select("id, display_name_en, display_name_ar").eq("id", inv.doctor_id).maybeSingle() : Promise.resolve({ data: null }),
    inv.appointment_id ? supabase.from("appointments").select("id, scheduled_at, visit_type").eq("id", inv.appointment_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("profiles").select("id, full_name"),
  ])
  if (!patient.data) return null
  return {
    invoice: inv,
    lines: (lines.data ?? []) as InvoiceLine[],
    payments: (payments.data ?? []) as Payment[],
    patient: patient.data as InvoiceBundle["patient"],
    insurance: (insurance.data as InvoiceBundle["insurance"]) ?? null,
    doctor: (doctor.data as InvoiceBundle["doctor"]) ?? null,
    appointment: (appointment.data as InvoiceBundle["appointment"]) ?? null,
    receivers: Object.fromEntries((profiles.data ?? []).map((p) => [p.id, p.full_name])),
  }
}
