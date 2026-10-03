import "server-only"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type {
  CycleDay,
  CycleEndometrium,
  CycleFollicle,
  CycleHormone,
  CycleMedication,
  FertilityCase,
  FertilityCycle,
} from "@/types/db"

export interface CycleBundle {
  cycle: FertilityCycle
  fcase: FertilityCase | null
  days: CycleDay[]
  medications: CycleMedication[]
  hormones: CycleHormone[]
  follicles: CycleFollicle[]
  endometrium: CycleEndometrium[]
  otherCycles: Pick<FertilityCycle, "id" | "cycle_number" | "status" | "started_at">[]
}

export async function getCycleBundle(patientId: string, cycleId: string): Promise<CycleBundle> {
  if (!/^[0-9a-f-]{36}$/.test(cycleId)) notFound()
  const supabase = await createClient()
  const { data: cycle } = await supabase
    .from("fertility_cycles")
    .select("*")
    .eq("id", cycleId)
    .eq("patient_id", patientId)
    .maybeSingle()
  if (!cycle) notFound()
  const [fcase, days, meds, hormones, follicles, endo, others] = await Promise.all([
    supabase.from("fertility_cases").select("*").eq("id", cycle.fertility_case_id).maybeSingle(),
    supabase.from("fertility_cycle_days").select("*").eq("cycle_id", cycleId).order("day_number"),
    supabase.from("fertility_cycle_medications").select("*").eq("cycle_id", cycleId),
    supabase.from("fertility_cycle_hormones").select("*").eq("cycle_id", cycleId),
    supabase.from("fertility_cycle_follicles").select("*").eq("cycle_id", cycleId),
    supabase.from("fertility_cycle_endometrium").select("*").eq("cycle_id", cycleId),
    supabase
      .from("fertility_cycles")
      .select("id, cycle_number, status, started_at")
      .eq("patient_id", patientId)
      .neq("id", cycleId)
      .order("cycle_number", { ascending: false }),
  ])
  return {
    cycle: cycle as FertilityCycle,
    fcase: (fcase.data as FertilityCase | null) ?? null,
    days: (days.data ?? []) as CycleDay[],
    medications: (meds.data ?? []) as CycleMedication[],
    hormones: (hormones.data ?? []) as CycleHormone[],
    follicles: (follicles.data ?? []) as CycleFollicle[],
    endometrium: (endo.data ?? []) as CycleEndometrium[],
    otherCycles: (others.data ?? []) as CycleBundle["otherCycles"],
  }
}
