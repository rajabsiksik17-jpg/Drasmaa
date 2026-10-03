"use client"

import { useState } from "react"
import { ThemeProvider } from "next-themes"
import { MotionConfig } from "motion/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Direction } from "radix-ui"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

export function Providers({ children, dir, nonce }: { children: React.ReactNode; dir: "ltr" | "rtl"; nonce?: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  )
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange nonce={nonce}>
      <Direction.Provider dir={dir}>
        <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={300}>
              {children}
              <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} dir={dir} richColors closeButton />
            </TooltipProvider>
          </QueryClientProvider>
        </MotionConfig>
      </Direction.Provider>
    </ThemeProvider>
  )
}
