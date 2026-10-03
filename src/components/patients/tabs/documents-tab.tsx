import { createClient } from "@/lib/supabase/server"
import { DocumentsBrowser } from "@/components/documents/documents-browser"
import { GeneratedDocuments } from "@/components/documents/generated-documents"
import type { GeneratedDocumentRow } from "@/lib/actions/generated-documents"
import type { PatientDocument } from "@/types/db"

export async function DocumentsTab({ patientId }: { patientId: string }) {
  const supabase = await createClient()
  const [{ data }, { data: profiles }, { data: generated }] = await Promise.all([
    supabase.from("documents").select("*").eq("patient_id", patientId).order("uploaded_at", { ascending: false }).limit(500),
    supabase.from("profiles").select("id, full_name"),
    supabase
      .from("generated_documents")
      .select(
        "id, document_type, title, file_name, size_bytes, language, orientation, version_no, status, source_entity_type, generated_at, expires_at, deleted_at, generator:profiles!generated_documents_generated_by_fkey(full_name)",
      )
      .eq("patient_id", patientId)
      .order("generated_at", { ascending: false })
      .limit(200),
  ])
  return (
    <div className="space-y-5">
      <GeneratedDocuments patientId={patientId} documents={(generated ?? []) as unknown as GeneratedDocumentRow[]} />
      <DocumentsBrowser
        patientId={patientId}
        documents={(data ?? []) as PatientDocument[]}
        people={Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]))}
      />
    </div>
  )
}
