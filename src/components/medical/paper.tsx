"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

/** A4-proportioned paper sheet. Width scales down on small screens. */
export function PaperSheet({
  children,
  className,
  orientation = "portrait",
  serif = false,
  id,
}: {
  children: React.ReactNode
  className?: string
  orientation?: "portrait" | "landscape"
  serif?: boolean
  id?: string
}) {
  return (
    <div
      id={id}
      className={cn(
        "paper mx-auto w-full",
        orientation === "portrait" ? "max-w-[210mm] px-5 py-6 sm:px-10 sm:py-10" : "max-w-[297mm] p-4 sm:p-6",
        orientation === "landscape" && "print-landscape",
        serif && "paper-serif",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Horizontal rule exactly like the paper's section separators. */
export function PaperRule({ className }: { className?: string }) {
  return <hr className={cn("my-4 border-0 border-t border-[color:var(--paper-line)]", className)} />
}

export function PaperHeading({ children, id, className }: { children: React.ReactNode; id?: string; className?: string }) {
  return (
    <h3 id={id} className={cn("paper-heading mb-3 scroll-mt-48 text-[17px]", className)}>
      {children}
    </h3>
  )
}

/** "- Label: ______" line used throughout the History & Examination sheet. */
export function PaperLine({
  label,
  children,
  dash = false,
  className,
  labelClassName,
}: {
  label: React.ReactNode
  children?: React.ReactNode
  dash?: boolean
  className?: string
  labelClassName?: string
}) {
  return (
    <div className={cn("flex min-w-0 items-baseline gap-2 py-[3px]", className)}>
      <span className={cn("paper-label shrink-0", labelClassName)}>
        {dash && "- "}
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export interface SectionLink {
  id: string
  label: string
}

/**
 * Long-form section navigation: sticky side list on large screens,
 * compact selector on phones; highlights the section in view.
 */
export function SectionNavigation({ sections, className }: { sections: SectionLink[]; className?: string }) {
  const t = useTranslations("forms")
  const [active, setActive] = useState(sections[0]?.id)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: "-30% 0px -60% 0px" },
    )
    for (const s of sections) {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sections])

  const go = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    const focusable = el.parentElement?.querySelector<HTMLElement>("input, textarea, select")
    setTimeout(() => focusable?.focus({ preventScroll: true }), 350)
  }

  return (
    <>
      <nav className={cn("no-print hidden lg:block", className)} aria-label={t("sections")}>
        <p className="mb-2 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("sections")}</p>
        <ul className="space-y-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => go(s.id)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-start text-sm transition",
                  active === s.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="no-print lg:hidden">
        <label className="sr-only" htmlFor="section-jump">
          {t("sections")}
        </label>
        <select
          id="section-jump"
          className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
          value={active}
          onChange={(e) => go(e.target.value)}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
