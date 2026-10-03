"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronDown, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Expand/collapse section used to reduce visual load in long forms. */
export function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
  id,
  aside,
}: {
  title: React.ReactNode
  icon?: LucideIcon
  defaultOpen?: boolean
  children: React.ReactNode
  id?: string
  aside?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section id={id} className="scroll-mt-48">
      <div className="no-print mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold hover:text-primary"
        >
          <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          {title}
        </button>
        {aside && <div className="ms-auto">{aside}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden print:!h-auto print:!opacity-100"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
