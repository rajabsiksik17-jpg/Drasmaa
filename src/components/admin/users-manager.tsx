"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { KeyRound, Loader2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { NativeSelect } from "@/components/common/native-select"
import { useActionError } from "@/hooks/use-action-error"
import { createUser, sendPasswordReset, updateUser } from "@/lib/actions/admin"
import { cn } from "@/lib/utils"
import type { Department, Profile, Role } from "@/types/db"

export function UsersManager({
  currentUserId,
  profiles,
  roles,
  departments,
}: {
  currentUserId: string
  profiles: Profile[]
  roles: Role[]
  departments: Department[]
}) {
  const t = useTranslations("admin")
  const tc = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()
  const { showError, message } = useActionError()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: "", full_name: "", full_name_ar: "", password: "", role_code: "receptionist", department_id: "" })
  const [error, setError] = useState<string | null>(null)
  const name = (r: Role | Department) => (locale === "ar" ? r.name_ar : r.name_en)

  const update = (id: string, patch: Omit<Parameters<typeof updateUser>[0], "id">) =>
    start(async () => {
      const res = await updateUser({ ...patch, id })
      if (!res.ok) return showError(res.error)
      toast.success(t("userUpdated"))
      router.refresh()
    })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <UserPlus />
          {t("newUser")}
        </Button>
      </div>
      <div className="scroll-x rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("user")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("role")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("department")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("active")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const self = p.id === currentUserId
              return (
                <tr key={p.id} className={cn("border-t", !p.active && "opacity-60")}>
                  <td className="px-3 py-2">
                    <p className="font-medium">
                      {p.full_name} {self && <span className="text-xs text-muted-foreground">({t("you")})</span>}
                    </p>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {p.email}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      className="h-8"
                      value={p.role_id ?? ""}
                      disabled={self || pending}
                      onChange={(e) => update(p.id, { role_id: e.target.value || null })}
                      aria-label={t("role")}
                    >
                      <option value="">—</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{name(r)}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      className="h-8"
                      value={p.department_id ?? ""}
                      disabled={pending}
                      onChange={(e) => update(p.id, { department_id: e.target.value || null })}
                      aria-label={t("department")}
                    >
                      <option value="">—</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{name(d)}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <Switch checked={p.active} disabled={self || pending} onCheckedChange={(v) => update(p.id, { active: v })} aria-label={t("active")} />
                  </td>
                  <td className="px-3 py-2 text-end">
                    {p.email && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          start(async () => {
                            const res = await sendPasswordReset(p.email!, window.location.origin)
                            if (!res.ok) return showError(res.error)
                            toast.success(t("resetSent"))
                          })
                        }
                      >
                        <KeyRound />
                        {t("sendReset")}
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newUser")}</DialogTitle>
            <DialogDescription>{t("newUserHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="u-email">{t("email")}</Label>
              <Input id="u-email" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="u-name">{t("nameEn")}</Label>
              <Input id="u-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="u-name-ar">{t("nameAr")}</Label>
              <Input id="u-name-ar" dir="rtl" value={form.full_name_ar} onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="u-role">{t("role")}</Label>
              <NativeSelect id="u-role" value={form.role_code} onChange={(e) => setForm({ ...form, role_code: e.target.value })}>
                {roles.filter((r) => r.active).map((r) => (
                  <option key={r.id} value={r.code}>{name(r)}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="u-dept">{t("department")}</Label>
              <NativeSelect id="u-dept" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                <option value="">—</option>
                {departments.filter((d) => d.active).map((d) => (
                  <option key={d.id} value={d.id}>{name(d)}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="u-pw">{t("initialPassword")}</Label>
              <Input id="u-pw" type="password" autoComplete="new-password" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t("passwordRule")}</p>
            </div>
            {form.role_code === "doctor" && <p className="text-xs text-muted-foreground sm:col-span-2">{t("doctorAutoCreated")}</p>}
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null)
                  const res = await createUser({ ...form, department_id: form.department_id || null, full_name_ar: form.full_name_ar || null })
                  if (!res.ok) return setError(message(res.error))
                  toast.success(t("userCreated"))
                  setOpen(false)
                  setForm({ email: "", full_name: "", full_name_ar: "", password: "", role_code: "receptionist", department_id: "" })
                  router.refresh()
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
