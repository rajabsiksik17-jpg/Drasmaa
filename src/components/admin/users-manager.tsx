"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { KeyRound, Loader2, MoreHorizontal, Pencil, Power, Search, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/common/native-select"
import { useActionError } from "@/hooks/use-action-error"
import { useSafeTransition } from "@/hooks/use-safe-transition"
import { createUser, sendPasswordReset } from "@/lib/actions/admin"
import { deleteUser, saveUser, setUserActive } from "@/lib/actions/staff"
import { cn } from "@/lib/utils"
import type { Department, Profile, Role } from "@/types/db"

type EditForm = { id: string; full_name: string; full_name_ar: string; phone: string; email: string; role_id: string; department_id: string }
const emptyNew = { email: "", full_name: "", full_name_ar: "", password: "", role_code: "receptionist", department_id: "" }

/**
 * Staff accounts: create, edit (name, phone, login e-mail, role, department),
 * deactivate / reactivate, and delete only when the account has no history
 * (otherwise deactivation keeps every record attributable).
 */
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
  const [pending, start] = useSafeTransition()
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyNew)
  const [createError, setCreateError] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditForm | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null)
  const [q, setQ] = useState("")
  const name = (r: Role | Department) => (locale === "ar" ? r.name_ar : r.name_en)
  const roleName = (id: string | null) => {
    const r = roles.find((x) => x.id === id)
    return r ? name(r) : "—"
  }
  const deptName = (id: string | null) => {
    const d = departments.find((x) => x.id === id)
    return d ? name(d) : ""
  }
  const query = q.trim().toLowerCase()
  const list = query
    ? profiles.filter((p) => `${p.full_name} ${p.full_name_ar ?? ""} ${p.email ?? ""} ${p.phone ?? ""}`.toLowerCase().includes(query))
    : profiles

  const toggleActive = (p: Profile) =>
    start(async () => {
      const res = await setUserActive(p.id, !p.active)
      if (!res.ok) return showError(res.error)
      toast.success(p.active ? t("userDeactivated") : t("userReactivated"))
      router.refresh()
    })

  const sendReset = (email: string) =>
    start(async () => {
      const res = await sendPasswordReset(email, window.location.origin)
      if (!res.ok) return showError(res.error)
      toast.success(t("resetSent"))
    })

  const actions = (p: Profile) => {
    const self = p.id === currentUserId
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t("actions")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() => {
              setEditError(null)
              setEdit({
                id: p.id,
                full_name: p.full_name,
                full_name_ar: p.full_name_ar ?? "",
                phone: p.phone ?? "",
                email: p.email ?? "",
                role_id: p.role_id ?? "",
                department_id: p.department_id ?? "",
              })
            }}
          >
            <Pencil />
            {t("editUser")}
          </DropdownMenuItem>
          {p.email && (
            <DropdownMenuItem onSelect={() => sendReset(p.email!)}>
              <KeyRound />
              {t("sendReset")}
            </DropdownMenuItem>
          )}
          {!self && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => toggleActive(p)}>
                <Power />
                {p.active ? t("deactivate") : t("reactivate")}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDelete(p)}>
                <Trash2 />
                {t("deleteUser")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchUsers")} className="ps-8" />
        </div>
        <Button className="ms-auto" onClick={() => setCreateOpen(true)}>
          <UserPlus />
          {t("newUser")}
        </Button>
      </div>

      {/* Phones: cards. Larger screens: table. */}
      <ul className="space-y-2 md:hidden">
        {list.map((p) => (
          <li key={p.id} className={cn("flex items-start gap-3 rounded-xl border bg-card p-3", !p.active && "opacity-60")}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {p.full_name} {p.id === currentUserId && <span className="text-xs text-muted-foreground">({t("you")})</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                {p.email}
              </p>
              <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-full bg-muted px-2 py-0.5">{roleName(p.role_id)}</span>
                {deptName(p.department_id) && <span className="rounded-full bg-muted px-2 py-0.5">{deptName(p.department_id)}</span>}
                {!p.active && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">{t("inactive")}</span>}
              </p>
            </div>
            {actions(p)}
          </li>
        ))}
      </ul>
      <div className="hidden rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("user")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("phone")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("role")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("department")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("active")}</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={cn("border-t", !p.active && "opacity-60")}>
                <td className="px-3 py-2">
                  <p className="font-medium">
                    {p.full_name} {p.id === currentUserId && <span className="text-xs text-muted-foreground">({t("you")})</span>}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {p.email}
                  </p>
                </td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">
                  {p.phone}
                </td>
                <td className="px-3 py-2">{roleName(p.role_id)}</td>
                <td className="px-3 py-2">{deptName(p.department_id)}</td>
                <td className="px-3 py-2">{p.active ? t("activeYes") : <span className="text-destructive">{t("inactive")}</span>}</td>
                <td className="px-3 py-2 text-end">{actions(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("editUser")}</DialogTitle>
            <DialogDescription>{t("editUserHint")}</DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ue-name">{t("nameEn")}</Label>
                <Input id="ue-name" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ue-name-ar">{t("nameAr")}</Label>
                <Input id="ue-name-ar" dir="rtl" value={edit.full_name_ar} onChange={(e) => setEdit({ ...edit, full_name_ar: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ue-email">{t("email")}</Label>
                <Input id="ue-email" type="email" dir="ltr" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ue-phone">{t("phone")}</Label>
                <Input id="ue-phone" type="tel" dir="ltr" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ue-role">{t("role")}</Label>
                <NativeSelect id="ue-role" value={edit.role_id} disabled={edit.id === currentUserId} onChange={(e) => setEdit({ ...edit, role_id: e.target.value })}>
                  <option value="">—</option>
                  {roles
                    .filter((r) => r.active || r.id === edit.role_id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {name(r)}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ue-dept">{t("department")}</Label>
                <NativeSelect id="ue-dept" value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}>
                  <option value="">—</option>
                  {departments
                    .filter((d) => d.active || d.id === edit.department_id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {name(d)}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              {editError && <p className="text-sm text-destructive sm:col-span-2">{editError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending || !edit?.full_name.trim() || !edit?.email.trim()}
              onClick={() =>
                start(async () => {
                  if (!edit) return
                  setEditError(null)
                  const res = await saveUser({
                    ...edit,
                    full_name_ar: edit.full_name_ar || null,
                    phone: edit.phone || null,
                    role_id: edit.role_id || null,
                    department_id: edit.department_id || null,
                  })
                  if (!res.ok) return setEditError(message(res.error, "saveUser"))
                  toast.success(t("userUpdated"))
                  setEdit(null)
                  router.refresh()
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteUserTitle", { name: confirmDelete?.full_name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteUserHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                start(async () => {
                  const p = confirmDelete
                  setConfirmDelete(null)
                  if (!p) return
                  const res = await deleteUser(p.id)
                  if (!res.ok) return toast.error(res.error.code === "inUse" ? t("userInUse") : message(res.error))
                  toast.success(t("userDeleted"))
                  router.refresh()
                })
              }
            >
              {t("deleteUser")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto">
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
                {roles
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.code}>
                      {name(r)}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="u-dept">{t("department")}</Label>
              <NativeSelect id="u-dept" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                <option value="">—</option>
                {departments
                  .filter((d) => d.active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {name(d)}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="u-pw">{t("initialPassword")}</Label>
              <Input id="u-pw" type="password" autoComplete="new-password" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t("passwordRule")}</p>
            </div>
            {form.role_code === "doctor" && <p className="text-xs text-muted-foreground sm:col-span-2">{t("doctorAutoCreated")}</p>}
            {createError && <p className="text-sm text-destructive sm:col-span-2">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setCreateError(null)
                  const res = await createUser({ ...form, department_id: form.department_id || null, full_name_ar: form.full_name_ar || null })
                  if (!res.ok) return setCreateError(message(res.error, "createUser"))
                  toast.success(t("userCreated"))
                  setCreateOpen(false)
                  setForm(emptyNew)
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
