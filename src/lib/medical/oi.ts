// Fixed structure of the Ovulation Induction chart (paper form v1).
// These are deliberately NOT admin-configurable: the chart's clinical
// structure must stay identical to the clinic's paper form.

export const OI_FORM_VERSION = 1

export const OI_MEDICATIONS = [
  { code: "gnrh_agon", label: "GnRH-agon" },
  { code: "gnrh_antag", label: "GnRH-antag" },
  { code: "hmg", label: "HMG" },
  { code: "fsh", label: "FSH" },
  { code: "rec_fsh", label: "Rec.FSH" },
  { code: "cc_letroz", label: "C.C/Letrz" },
  { code: "estrolem", label: "Estrolem" },
] as const

export const OI_HORMONES = [
  { code: "amh", label: "AMH", investigation: "amh" },
  { code: "fsh", label: "FSH", investigation: "fsh" },
  { code: "lh", label: "LH", investigation: "lh" },
  { code: "e2", label: "E2", investigation: "e2" },
  { code: "p4", label: "P4", investigation: "p4" },
  { code: "prolactin", label: "Prolactin", investigation: "prl" },
  { code: "tsh", label: "TSH", investigation: "tsh" },
] as const

export const OI_PROCEDURES = [
  { value: "tsi", label: "TSI" },
  { value: "iui", label: "IUI" },
  { value: "icsi", label: "ICSI" },
  { value: "frzn_et", label: "Frzn ET" },
] as const

export const OI_ADDONS = [
  { value: "bc", label: "BC" },
  { value: "aha", label: "AHA" },
  { value: "imsi", label: "IMSI" },
  { value: "e_glue", label: "E.Glue" },
] as const

export const OI_SPERM_RETRIEVAL = [
  { value: "tesa", label: "TESA" },
  { value: "tese", label: "TESE" },
  { value: "m_tese", label: "M.TESE" },
] as const

/** Follicle grid: R/L pair under each of days 2–15 (28 columns). */
export const FOLLICLE_DAYS = Array.from({ length: 14 }, (_, i) => i + 2)
export const FOLLICLE_ROWS = 12
export const SIDES = ["R", "L"] as const
