import { Skeleton } from "@/components/ui/skeleton"

export function TabSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-busy="true" aria-live="polite">
      <div className="space-y-3 lg:col-span-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 rounded-lg" />
      ))}
    </div>
  )
}

export function PaperSkeleton() {
  return (
    <div className="mx-auto max-w-[210mm] space-y-4 rounded bg-card p-8 shadow-sm" aria-busy="true">
      <Skeleton className="mx-auto h-6 w-64" />
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-5" />
      ))}
    </div>
  )
}
