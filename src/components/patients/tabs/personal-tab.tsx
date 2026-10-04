"use client"

import { useTranslations } from "next-intl"
import { Archive, ArchiveRestore, HeartHandshake, MessageCircle, UserRound, Wallet } from "lucide-react"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { InlineEdit } from "@/components/forms/inline-edit"
import { SectionCard } from "@/components/common/page"
import { Button } from "@/components/ui/button"
import { useCan, useRefs } from "@/components/app-context"
import { setPatientArchived } from "@/lib/actions/patients"
import { ageFromDob, formatDate } from "@/lib/dates"
import { P } from "@/lib/permissions"
import type { PatientContext } from "@/lib/data/patient"
import { useSafeTransition } from "@/hooks/use-safe-transition"

/** A labelled value that can be edited in place (EditableField). */
export function EditableField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-h-7 text-sm">{children}</dd>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

const BLOOD = ["A", "B", "AB", "O"].map((v) => ({ value: v, label: v }))
const RH = [
  { value: "+", label: "+" },
  { value: "-", label: "−" },
]

export function PersonalTab({ ctx }: { ctx: PatientContext }) {
  const t = useTranslations("personal")
  const can = useCan()
  const refs = useRefs()
  const router = useRouter()
  const [pending, start] = useSafeTransition()
  const { patient: p, husband: h } = ctx
  const edit = can(P.patientsEdit)
  const ageHint = (dob: string | null) => (dob ? t("ageCalculated", { age: ageFromDob(dob) ?? "—" }) : null)

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <SectionCard title={t("wife")} icon={UserRound}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <EditableField label={t("fullName")}>
            <InlineEdit table="patients" recordKey={p.id} field="full_name" version={p.version} value={p.full_name} label={t("fullName")} canEdit={edit} />
          </EditableField>
          <EditableField label={t("dob")} hint={ageHint(p.dob)}>
            <InlineEdit table="patients" recordKey={p.id} field="dob" version={p.version} value={p.dob} type="date" display={formatDate(p.dob)} label={t("dob")} canEdit={edit} />
          </EditableField>
          <EditableField label={t("phone")}>
            <span dir="ltr">
              <InlineEdit table="patients" recordKey={p.id} field="phone" version={p.version} value={p.phone} type="tel" label={t("phone")} canEdit={edit} />
            </span>
          </EditableField>
          <EditableField label={t("occupation")}>
            <InlineEdit table="patients" recordKey={p.id} field="occupation" version={p.version} value={p.occupation} label={t("occupation")} canEdit={edit} />
          </EditableField>
          <EditableField label={t("address")}>
            <InlineEdit table="patients" recordKey={p.id} field="address" version={p.version} value={p.address} type="textarea" label={t("address")} canEdit={edit} />
          </EditableField>
          <EditableField label={t("marriageDate")}>
            <InlineEdit table="patients" recordKey={p.id} field="marriage_date" version={p.version} value={p.marriage_date} type="date" display={formatDate(p.marriage_date)} label={t("marriageDate")} canEdit={edit} />
          </EditableField>
          <EditableField label={t("bloodGroup")}>
            <span className="inline-flex items-center gap-3">
              <InlineEdit table="patients" recordKey={p.id} field="blood_group" version={p.version} value={p.blood_group} type="select" options={BLOOD} label={t("bloodGroup")} canEdit={edit} />
              <InlineEdit table="patients" recordKey={p.id} field="rh" version={p.version} value={p.rh} type="select" options={RH} label={t("rh")} canEdit={edit} display={p.rh ? `Rh ${p.rh}` : null} />
            </span>
          </EditableField>
          <EditableField label={t("patientId")}>
            <span className="font-mono">{p.patient_code}</span>
          </EditableField>
        </dl>
      </SectionCard>

      <SectionCard title={t("contact")} icon={MessageCircle}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <EditableField label={t("email")}>
            <span dir="ltr">
              <InlineEdit table="patients" recordKey={p.id} field="email" version={p.version} value={p.email} label={t("email")} canEdit={edit} />
            </span>
          </EditableField>
          <EditableField label={t("whatsappPhone")} hint={t("whatsappHint")}>
            <span dir="ltr">
              <InlineEdit table="patients" recordKey={p.id} field="whatsapp_phone" version={p.version} value={p.whatsapp_phone} type="tel" label={t("whatsappPhone")} canEdit={edit} />
            </span>
          </EditableField>
          <EditableField label={t("preferredLanguage")}>
            <InlineEdit
              table="patients"
              recordKey={p.id}
              field="preferred_language"
              version={p.version}
              value={p.preferred_language}
              type="select"
              options={[
                { value: "ar", label: "العربية" },
                { value: "en", label: "English" },
              ]}
              label={t("preferredLanguage")}
              canEdit={edit}
            />
          </EditableField>
          <EditableField label={t("assignedDoctor")}>
            <InlineEdit
              table="patients"
              recordKey={p.id}
              field="assigned_doctor_id"
              version={p.version}
              value={p.assigned_doctor_id}
              type="select"
              options={refs.activeDoctors(p.assigned_doctor_id)}
              label={t("assignedDoctor")}
              canEdit={edit}
            />
          </EditableField>
        </dl>
      </SectionCard>

      <SectionCard title={t("husband")} icon={HeartHandshake}>
        {h ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <EditableField label={t("fullName")}>
              <InlineEdit table="patient_husbands" recordKey={p.id} field="full_name" version={h.version} value={h.full_name} label={t("husbandName")} canEdit={edit} />
            </EditableField>
            <EditableField label={t("dob")} hint={ageHint(h.dob)}>
              <InlineEdit table="patient_husbands" recordKey={p.id} field="dob" version={h.version} value={h.dob} type="date" display={formatDate(h.dob)} label={t("dob")} canEdit={edit} />
            </EditableField>
            <EditableField label={t("occupation")}>
              <InlineEdit table="patient_husbands" recordKey={p.id} field="occupation" version={h.version} value={h.occupation} label={t("occupation")} canEdit={edit} />
            </EditableField>
            <EditableField label={t("phone")}>
              <span dir="ltr">
                <InlineEdit table="patient_husbands" recordKey={p.id} field="phone" version={h.version} value={h.phone} type="tel" label={t("phone")} canEdit={edit} />
              </span>
            </EditableField>
            <EditableField label={t("bloodGroup")}>
              <span className="inline-flex items-center gap-3">
                <InlineEdit table="patient_husbands" recordKey={p.id} field="blood_group" version={h.version} value={h.blood_group} type="select" options={BLOOD} label={t("bloodGroup")} canEdit={edit} />
                <InlineEdit table="patient_husbands" recordKey={p.id} field="rh" version={h.version} value={h.rh} type="select" options={RH} label={t("rh")} canEdit={edit} display={h.rh ? `Rh ${h.rh}` : null} />
              </span>
            </EditableField>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </SectionCard>

      <SectionCard title={t("payment")} icon={Wallet}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <EditableField label={t("paymentMethod")}>
            <InlineEdit
              table="patients"
              recordKey={p.id}
              field="payment_method"
              version={p.version}
              value={p.payment_method}
              type="select"
              options={[
                { value: "cash", label: t("cash") },
                { value: "insurance", label: t("insurance") },
              ]}
              label={t("paymentMethod")}
              canEdit={edit}
            />
          </EditableField>
          {p.payment_method === "insurance" && (
            <EditableField label={t("insuranceCompany")}>
              <InlineEdit
                table="patients"
                recordKey={p.id}
                field="insurance_company_id"
                version={p.version}
                value={p.insurance_company_id}
                type="select"
                options={refs.activeInsurance(p.insurance_company_id)}
                label={t("insuranceCompany")}
                canEdit={edit}
              />
            </EditableField>
          )}
        </dl>
      </SectionCard>

      {can(P.patientsArchive) && (
        <SectionCard title={t("fileStatus")}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">{p.status === "archived" ? t("archivedHint") : t("activeHint")}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await setPatientArchived(p.id, p.status !== "archived")
                  if (res.ok) {
                    toast.success(p.status === "archived" ? t("restored") : t("archivedDone"))
                    router.refresh()
                  }
                })
              }
            >
              {p.status === "archived" ? <ArchiveRestore /> : <Archive />}
              {p.status === "archived" ? t("restore") : t("archive")}
            </Button>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
