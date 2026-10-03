import "server-only"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type {
  FertilityCase,
  FertilityCycle,
  FertilityHusbandData,
  FertilityVisit,
  FertilityWifeData,
  GynecologyVisit,
  Investigation,
  InvestigationResult,
  IvfConsent,
  PatientDocument,
  PregnancyCase,
  PregnancyFollowup,
  UltrasoundAnnotation,
  Visit,
  VisitClinical,
} from "@/types/db"

export interface VisitBundle {
  visit: Visit & { doctor: { display_name_en: string; display_name_ar: string | null } | null }
  clinical: VisitClinical | null
  results: InvestigationResult[]
  investigations: Investigation[]
  /** Latest result per type recorded before this visit (for "previous" hints). */
  previousResults: InvestigationResult[]
  fertility?: {
    visit: FertilityVisit | null
    husband: FertilityHusbandData | null
    wife: FertilityWifeData | null
    fcase: FertilityCase | null
    documents: PatientDocument[]
    consents: IvfConsent[]
    activeCycle: Pick<FertilityCycle, "id" | "cycle_number" | "status"> | null
    previousVisits: Pick<Visit, "id" | "visit_date" | "status">[]
  }
  pregnancy?: {
    pcase: PregnancyCase | null
    followups: PregnancyFollowup[]
  }
  gynecology?: {
    gvisit: GynecologyVisit | null
    annotation: UltrasoundAnnotation | null
  }
}

export async function getVisitBundle(patientId: string, visitId: string): Promise<VisitBundle> {
  if (!/^[0-9a-f-]{36}$/.test(visitId)) notFound()
  const supabase = await createClient()
  const { data: visit } = await supabase
    .from("visits")
    .select("*, doctor:doctors(display_name_en, display_name_ar)")
    .eq("id", visitId)
    .eq("patient_id", patientId)
    .maybeSingle()
  if (!visit) notFound()

  const [clinical, results, investigations, previousResults] = await Promise.all([
    supabase.from("visit_clinical").select("*").eq("visit_id", visitId).maybeSingle(),
    supabase.from("investigation_results").select("*").eq("visit_id", visitId),
    supabase.from("investigations").select("*").eq("visit_id", visitId),
    supabase
      .from("investigation_results")
      .select("*")
      .eq("patient_id", patientId)
      .or(`visit_id.is.null,visit_id.neq.${visitId}`)
      .lte("result_date", visit.visit_date)
      .order("result_date", { ascending: false })
      .limit(200),
  ])
  const latestByType = new Map<string, InvestigationResult>()
  for (const r of (previousResults.data ?? []) as InvestigationResult[]) {
    if (!latestByType.has(r.type_code)) latestByType.set(r.type_code, r)
  }

  const bundle: VisitBundle = {
    visit: visit as VisitBundle["visit"],
    clinical: (clinical.data as VisitClinical | null) ?? null,
    results: (results.data ?? []) as InvestigationResult[],
    investigations: (investigations.data ?? []) as Investigation[],
    previousResults: [...latestByType.values()],
  }

  if (visit.visit_type === "fertility") {
    const caseId = visit.fertility_case_id as string | null
    const [fv, husband, wife, fcase, docs, consents, cycle, prev] = await Promise.all([
      supabase.from("fertility_visits").select("*").eq("visit_id", visitId).maybeSingle(),
      supabase.from("fertility_husband_data").select("*").eq("visit_id", visitId).maybeSingle(),
      supabase.from("fertility_wife_data").select("*").eq("visit_id", visitId).maybeSingle(),
      caseId ? supabase.from("fertility_cases").select("*").eq("id", caseId).maybeSingle() : Promise.resolve({ data: null }),
      supabase
        .from("documents")
        .select("*")
        .eq("patient_id", patientId)
        .in("category", ["sfa", "ivf_consent"])
        .eq("status", "active")
        .order("uploaded_at", { ascending: false }),
      caseId
        ? supabase.from("ivf_consents").select("*").eq("fertility_case_id", caseId).neq("status", "void").order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      caseId
        ? supabase.from("fertility_cycles").select("id, cycle_number, status").eq("fertility_case_id", caseId).eq("status", "active").maybeSingle()
        : Promise.resolve({ data: null }),
      caseId
        ? supabase.from("visits").select("id, visit_date, status").eq("fertility_case_id", caseId).neq("id", visitId).order("started_at", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] }),
    ])
    bundle.fertility = {
      visit: fv.data as FertilityVisit | null,
      husband: husband.data as FertilityHusbandData | null,
      wife: wife.data as FertilityWifeData | null,
      fcase: fcase.data as FertilityCase | null,
      documents: (docs.data ?? []) as PatientDocument[],
      consents: (consents.data ?? []) as IvfConsent[],
      activeCycle: (cycle.data as Pick<FertilityCycle, "id" | "cycle_number" | "status"> | null) ?? null,
      previousVisits: (prev.data ?? []) as Pick<Visit, "id" | "visit_date" | "status">[],
    }
  } else if (visit.visit_type === "pregnancy") {
    const caseId = visit.pregnancy_case_id as string | null
    const [pcase, followups] = await Promise.all([
      caseId ? supabase.from("pregnancy_cases").select("*").eq("id", caseId).maybeSingle() : Promise.resolve({ data: null }),
      caseId
        ? supabase.from("pregnancy_followups").select("*").eq("pregnancy_case_id", caseId).order("visit_no")
        : Promise.resolve({ data: [] }),
    ])
    bundle.pregnancy = {
      pcase: pcase.data as PregnancyCase | null,
      followups: (followups.data ?? []) as PregnancyFollowup[],
    }
  } else {
    const [gv, ann] = await Promise.all([
      supabase.from("gynecology_visits").select("*").eq("visit_id", visitId).maybeSingle(),
      supabase.from("ultrasound_annotations").select("*").eq("visit_id", visitId).maybeSingle(),
    ])
    bundle.gynecology = {
      gvisit: gv.data as GynecologyVisit | null,
      annotation: ann.data as UltrasoundAnnotation | null,
    }
  }
  return bundle
}
