"use server"

import { z } from "zod"
import { authorize } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { dbFail, fail, ok, type ActionResult } from "@/lib/errors"
import { P } from "@/lib/permissions"
import { RECORDS, isRecordTable, parsePatch } from "@/lib/validation/record-schemas"

export type SaveRecordResult = ActionResult<{ row: Record<string, unknown> }> & {
  /** Present on conflict: the newer server row the user must review. */
  latest?: Record<string, unknown>
}

/**
 * Generic, whitelisted, optimistic-concurrency update used by inline
 * editing and autosave across the application.
 *
 * - Only fields declared in RECORDS[table] are writable (Zod, strict).
 * - The update only applies if the row still has `expectedVersion`;
 *   otherwise the newer row is returned as a conflict (never overwritten).
 * - Permissions are checked here AND enforced by RLS in the database.
 * - `reason` is recorded in the audit log and is required by the database
 *   to correct completed/historical records.
 */
export async function saveRecord(input: {
  table: string
  key: string
  patch: Record<string, unknown>
  expectedVersion: number
  reason?: string | null
}): Promise<SaveRecordResult> {
  if (!isRecordTable(input.table)) return fail("validation")
  const config = RECORDS[input.table]
  const auth = await authorize(config.permission)
  if (auth.error) return auth.error
  if (!z.uuid().safeParse(input.key).success) {
    return fail("validation")
  }

  const parsed = parsePatch(input.table, input.patch)
  if (!parsed.success) {
    return fail(
      "validation",
      parsed.error.issues.map((i) => String(i.path[0] ?? "")).filter(Boolean),
    )
  }
  const patch = parsed.data as Record<string, unknown>
  if (Object.keys(patch).length === 0) return fail("validation")

  const supabase = await createClient({ auditReason: input.reason })
  const { data, error } = await supabase
    .from(input.table)
    .update(patch)
    .eq(config.key, input.key)
    .eq("version", input.expectedVersion)
    .select()
    .maybeSingle()

  if (error) return dbFail(`saveRecord ${input.table}`, error)

  if (!data) {
    const { data: current } = await supabase.from(input.table).select().eq(config.key, input.key).maybeSingle()
    if (!current) return fail("notFound")
    if (current.version !== input.expectedVersion) {
      return { ok: false, error: { code: "conflict" }, latest: current }
    }
    return fail("forbidden")
  }

  // First real edit of a draft visit marks it "in progress".
  if ("visitColumn" in config && config.visitColumn) {
    const visitId = data[config.visitColumn] as string | undefined
    if (visitId) {
      await supabase.from("visits").update({ status: "in_progress" }).eq("id", visitId).eq("status", "draft")
    }
  }

  return ok({ row: data })
}

const CELL_TABLES = {
  fertility_cycle_medications: { keys: ["medication_code", "day_number"], field: "value" },
  fertility_cycle_follicles: { keys: ["day_number", "side", "row_index"], field: "size" },
  fertility_cycle_endometrium: { keys: ["day_number"], field: "value" },
} as const

const cellSchema = z.object({
  table: z.enum(["fertility_cycle_medications", "fertility_cycle_follicles", "fertility_cycle_endometrium"]),
  cycleId: z.uuid(),
  keys: z.object({
    medication_code: z
      .enum(["gnrh_agon", "gnrh_antag", "hmg", "fsh", "rec_fsh", "cc_letroz", "estrolem"])
      .optional(),
    day_number: z.number().int().min(1).max(15),
    side: z.enum(["R", "L"]).optional(),
    row_index: z.number().int().min(0).max(29).optional(),
  }),
  value: z
    .string()
    .max(40)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable(),
  expectedVersion: z.number().int().nullable(),
  reason: z.string().max(500).nullable().optional(),
})

/**
 * Upsert one O/I chart cell with the same conflict protection: a new cell
 * is inserted only if nobody created it meanwhile; an existing cell is
 * updated only if its version is unchanged.
 */
export async function saveCycleCell(input: z.input<typeof cellSchema>): Promise<SaveRecordResult> {
  const auth = await authorize(P.oiEdit)
  if (auth.error) return auth.error
  const parsed = cellSchema.safeParse(input)
  if (!parsed.success) return fail("validation")
  const { table, cycleId, keys, value, expectedVersion, reason } = parsed.data
  const spec = CELL_TABLES[table]
  const match: Record<string, unknown> = { cycle_id: cycleId }
  for (const k of spec.keys) {
    const v = keys[k as keyof typeof keys]
    if (v === undefined) return fail("validation")
    match[k] = v
  }

  const supabase = await createClient({ auditReason: reason })
  if (expectedVersion == null) {
    const { data, error } = await supabase
      .from(table)
      .upsert({ ...match, [spec.field]: value }, { onConflict: ["cycle_id", ...spec.keys].join(","), ignoreDuplicates: true })
      .select()
      .maybeSingle()
    if (error) return dbFail(`saveCycleCell insert ${table}`, error)
    if (data) return ok({ row: data })
    const { data: current } = await supabase.from(table).select().match(match).maybeSingle()
    return current ? { ok: false, error: { code: "conflict" }, latest: current } : fail("forbidden")
  }

  const { data, error } = await supabase
    .from(table)
    .update({ [spec.field]: value })
    .match(match)
    .eq("version", expectedVersion)
    .select()
    .maybeSingle()
  if (error) return dbFail(`saveCycleCell update ${table}`, error)
  if (data) return ok({ row: data })
  const { data: current } = await supabase.from(table).select().match(match).maybeSingle()
  if (!current) return fail("notFound")
  return { ok: false, error: { code: "conflict" }, latest: current }
}
