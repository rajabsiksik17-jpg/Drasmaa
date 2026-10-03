"use client"

import { Fragment, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useActionError } from "@/hooks/use-action-error"
import { createRole, setRolePermission } from "@/lib/actions/admin"
import type { Permission, Role } from "@/types/db"

const LOCKED = new Set(["users.manage", "roles.manage"])

export function PermissionMatrix({ roles, permissions, grants: initial }: { roles: Role[]; permissions: Permission[]; grants: string[] }) {
  const t = useTranslations("admin")
  const locale = useLocale()
  const router = useRouter()
  const { showError } = useActionError()
  const [grants, setGrants] = useState(new Set(initial))
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [newRole, setNewRole] = useState({ code: "", name_en: "", name_ar: "" })

  const groups = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    ;(acc[p.group_code] ??= []).push(p)
    return acc
  }, {})

  const toggle = (role: Role, perm: string, granted: boolean) => {
    const key = `${role.id}:${perm}`
    setBusy(key)
    setGrants((g) => {
      const n = new Set(g)
      if (granted) n.add(key)
      else n.delete(key)
      return n
    })
    start(async () => {
      const res = await setRolePermission({ roleId: role.id, permission: perm, granted })
      setBusy(null)
      if (!res.ok) {
        showError(res.error)
        setGrants((g) => {
          const n = new Set(g)
          if (granted) n.delete(key)
          else n.add(key)
          return n
        })
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="scroll-x rounded-xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 bg-muted/70 text-xs backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("permission")}</th>
              {roles.map((r) => (
                <th key={r.id} className="px-3 py-2 text-center font-medium">
                  {locale === "ar" ? r.name_ar : r.name_en}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(groups).map(([group, perms]) => (
              <Fragment key={group}>
                <tr className="bg-muted/30">
                  <td colSpan={roles.length + 1} className="px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t(`permGroup.${group}`)}
                  </td>
                </tr>
                {perms.map((p) => (
                  <tr key={p.code} className="border-t">
                    <td className="px-3 py-2">
                      <p>{locale === "ar" ? p.description_ar : p.description_en}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{p.code}</p>
                    </td>
                    {roles.map((r) => {
                      const key = `${r.id}:${p.code}`
                      const locked = r.code === "admin" && LOCKED.has(p.code)
                      return (
                        <td key={r.id} className="px-3 py-2 text-center">
                          {busy === key && pending ? (
                            <Loader2 className="mx-auto size-4 animate-spin" />
                          ) : (
                            <Checkbox
                              checked={grants.has(key)}
                              disabled={locked}
                              onCheckedChange={(v) => toggle(r, p.code, v === true)}
                              aria-label={`${r.name_en}: ${p.code}`}
                            />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">{t("code")}</span>
          <Input value={newRole.code} onChange={(e) => setNewRole({ ...newRole, code: e.target.value })} className="h-8 w-36 font-mono" dir="ltr" placeholder="nurse" />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">{t("nameEn")}</span>
          <Input value={newRole.name_en} onChange={(e) => setNewRole({ ...newRole, name_en: e.target.value })} className="h-8 w-44" dir="ltr" />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">{t("nameAr")}</span>
          <Input value={newRole.name_ar} onChange={(e) => setNewRole({ ...newRole, name_ar: e.target.value })} className="h-8 w-44" dir="rtl" />
        </div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await createRole(newRole)
              if (!res.ok) return showError(res.error)
              toast.success(t("roleCreated"))
              setNewRole({ code: "", name_en: "", name_ar: "" })
              router.refresh()
            })
          }
        >
          <Plus />
          {t("newRole")}
        </Button>
      </div>
    </div>
  )
}
