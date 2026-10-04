"use client"


import { useTranslations } from "next-intl"
import { Download, ExternalLink, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { getDocumentUrl } from "@/lib/actions/documents"
import { cn } from "@/lib/utils"
import { useSafeTransition } from "@/hooks/use-safe-transition"

/** Opens a private document through a short-lived signed URL (never a public link). */
export function DocumentLink({
  documentId,
  children,
  download = false,
  className,
}: {
  documentId: string
  children?: React.ReactNode
  download?: boolean
  className?: string
}) {
  const t = useTranslations("documents")
  const [pending, start] = useSafeTransition()
  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          // Open synchronously-created tab to avoid popup blockers on Safari.
          const tab = download ? null : window.open("about:blank", "_blank")
          if (tab) tab.opener = null
          const res = await getDocumentUrl(documentId, download)
          if (!res.ok) {
            tab?.close()
            toast.error(t("openFailed"))
            return
          }
          if (download) window.location.assign(res.data.url)
          else if (tab) tab.location.href = res.data.url
          else window.open(res.data.url, "_blank", "noopener")
        })
      }
      className={cn("inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-60", className)}
      disabled={pending}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : download ? <Download className="size-3.5" /> : <ExternalLink className="size-3.5" />}
      {children ?? (download ? t("download") : t("view"))}
    </button>
  )
}
