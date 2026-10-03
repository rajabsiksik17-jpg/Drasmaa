import { NextResponse, type NextRequest } from "next/server"
import { getSession } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { DOCUMENTS_BUCKET } from "@/lib/supabase/env"

/**
 * Serves a generated PDF to an authorized user. The document row is read
 * with the user's RLS-bound client (patient access + documents.view or own
 * export), so changing the id in the URL cannot reveal another patient's
 * file. The storage path is never exposed and no signed URL is issued.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse(null, { status: 404 })
  const session = await getSession()
  if (!session || session.state !== "active") return new NextResponse(null, { status: 401 })

  const supabase = await createClient()
  const { data: doc } = await supabase
    .from("generated_documents")
    .select("id, storage_path, file_name, status")
    .eq("id", id)
    .maybeSingle()
  if (!doc || doc.status !== "generated") return new NextResponse(null, { status: 404 })

  const { data: blob, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(doc.storage_path)
  if (error || !blob) return new NextResponse(null, { status: 404 })

  const download = request.nextUrl.searchParams.get("download") === "1"
  await supabase.rpc("log_document_access", {
    p_generated: doc.id,
    p_document: null,
    p_action: download ? "downloaded" : "viewed",
  })

  const ascii = doc.file_name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return new NextResponse(blob.stream(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(blob.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  })
}
