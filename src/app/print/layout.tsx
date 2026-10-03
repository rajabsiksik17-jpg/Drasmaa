import { requireSession } from "@/lib/auth/session"
import { getReferenceData } from "@/lib/data/reference"
import { AppProvider } from "@/components/app-context"
import { headers } from "next/headers"
import { PrintToolbar } from "@/components/print/print-toolbar"
import { PdfRenderMode } from "@/components/print/pdf-ready"

export const metadata = { title: "Print", robots: { index: false } }

/** Print views: no navigation chrome, paper-white, A4 page rules. */
export default async function PrintLayout({ children }: LayoutProps<"/print">) {
  const session = await requireSession()
  const refs = await getReferenceData()
  // pdf = headless renderer; preview = in-app document preview (no toolbar).
  const mode = (await headers()).get("x-clinic-render")
  return (
    <AppProvider
      session={{
        userId: session.userId,
        email: session.email,
        fullName: session.profile.full_name,
        roleCode: session.role?.code ?? null,
        roleNameEn: session.role?.name_en ?? null,
        roleNameAr: session.role?.name_ar ?? null,
        permissions: session.permissions,
        doctorId: session.doctor?.id ?? null,
        preferences: session.profile.preferences ?? {},
      }}
      refs={refs}
    >
      {mode ? (
        <div className={mode === "pdf" ? "bg-white" : "min-h-dvh bg-muted/40 py-4"} data-render={mode}>
          <div className={mode === "pdf" ? "" : "px-3"}>{mode === "pdf" ? <PdfRenderMode>{children}</PdfRenderMode> : children}</div>
        </div>
      ) : (
        <div className="min-h-dvh bg-muted/40 py-6 print:bg-white print:py-0">
          <PrintToolbar />
          <div className="px-3 print:px-0">{children}</div>
        </div>
      )}
    </AppProvider>
  )
}
