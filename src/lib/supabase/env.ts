export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""

// Supports both the new publishable key and the legacy anon key name.
export const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY)

export const DOCUMENTS_BUCKET = "patient-documents"
