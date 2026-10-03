import { Skeleton } from "@/components/ui/skeleton"
import { TabSkeleton } from "@/components/common/skeletons"

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3 border-b pb-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <Skeleton className="h-8 w-full max-w-2xl" />
      <TabSkeleton />
    </div>
  )
}
