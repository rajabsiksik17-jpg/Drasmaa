import { z } from "zod"

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null))

const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "invalidDate" })
  .refine((v) => !v || v <= new Date().toISOString().slice(0, 10), { message: "futureDate" })
  .transform((v) => (v ? v : null))

const phone = z
  .string()
  .trim()
  .min(1, { message: "required" })
  .max(30)
  .refine((v) => v.replace(/\D/g, "").length >= 7, { message: "invalidPhone" })

const bloodGroup = z.enum(["A", "B", "AB", "O"]).optional().nullable()
const rh = z.enum(["+", "-"]).optional().nullable()

export const newPatientSchema = z
  .object({
    full_name: z.string().trim().min(2, { message: "required" }).max(200),
    dob: optionalDate,
    occupation: optionalText(200),
    phone,
    address: optionalText(500),
    marriage_date: optionalDate,
    blood_group: bloodGroup,
    rh,
    husband: z.object({
      full_name: optionalText(200),
      dob: optionalDate,
      occupation: optionalText(200),
      blood_group: bloodGroup,
      rh,
    }),
    payment_method: z.enum(["cash", "insurance"]),
    insurance_company_id: z.string().optional().nullable(),
    // Final choice is made by the database (single active doctor rule).
    assigned_doctor_id: z.string().optional().nullable(),
    // "The patient is here now": open the first clinic visit in the same transaction.
    visit: z
      .object({
        doctor_id: z.string().optional().nullable(),
        service_id: z.string().optional().nullable(),
        reason: z.string().trim().max(500).optional().nullable(),
        no_charge: z.boolean().optional(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.payment_method === "insurance" && !v.insurance_company_id) {
      ctx.addIssue({ code: "custom", path: ["insurance_company_id"], message: "required" })
    }
  })

export type NewPatientInput = z.input<typeof newPatientSchema>
export type NewPatientOutput = z.output<typeof newPatientSchema>
