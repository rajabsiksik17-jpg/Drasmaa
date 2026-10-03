"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, Loader2, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { searchPatients, type PatientSearchRow } from "@/lib/actions/patients"
import { formatDate } from "@/lib/dates"
import { cn } from "@/lib/utils"

export interface PickedPatient {
  id: string
  full_name: string
  patient_code: string
}

/** Server-side, debounced patient search combobox (never loads all patients). */
export function PatientPicker({
  value,
  onChange,
  invalid,
}: {
  value: PickedPatient | null
  onChange: (p: PickedPatient | null) => void
  invalid?: boolean
}) {
  const t = useTranslations("patients")
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  const results = useQuery({
    queryKey: ["patient-picker", debounced],
    queryFn: async (): Promise<PatientSearchRow[]> => {
      const res = await searchPatients(debounced, 0, 10)
      return res.ok ? res.data : []
    },
    enabled: open && debounced.length >= 2,
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className={cn("h-9 w-full justify-between font-normal", !value && "text-muted-foreground")}
        >
          <span className="flex min-w-0 items-center gap-2">
            <UserRound className="size-4 shrink-0 opacity-60" />
            <span className="truncate">{value ? `${value.full_name} · ${value.patient_code}` : t("pickPatient")}</span>
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("searchPlaceholder")} />
          <CommandList>
            <CommandEmpty>
              {results.isFetching ? <Loader2 className="mx-auto size-4 animate-spin" /> : debounced.length < 2 ? t("typeToSearch") : t("noResults")}
            </CommandEmpty>
            {results.data && results.data.length > 0 && (
              <CommandGroup>
                {results.data.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onChange({ id: p.id, full_name: p.full_name, patient_code: p.patient_code })
                      setOpen(false)
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{p.full_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.patient_code} · {p.dob ? formatDate(p.dob) : "—"} · <span dir="ltr">{p.phone ?? "—"}</span>
                      </span>
                    </div>
                    {value?.id === p.id && <Check />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
