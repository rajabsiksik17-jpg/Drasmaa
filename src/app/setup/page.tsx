import { redirect } from "next/navigation"
import { isSupabaseConfigured } from "@/lib/supabase/env"

export const metadata = { title: "Setup required" }

// Shown only when the Supabase environment variables are missing.
export default function SetupPage() {
  if (isSupabaseConfigured) redirect("/login")
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Connect a Supabase project</h1>
      <p className="text-muted-foreground">
        The application needs a Supabase project (PostgreSQL, Auth, Realtime, Storage). Create{" "}
        <code className="rounded bg-muted px-1">.env.local</code> from <code className="rounded bg-muted px-1">.env.example</code> and restart the server.
      </p>
      <ol className="list-decimal space-y-2 ps-6 text-sm">
        <li>
          Local: <code className="rounded bg-muted px-1">npx supabase start</code> then{" "}
          <code className="rounded bg-muted px-1">npx supabase db reset</code> (applies migrations + development seed).
        </li>
        <li>
          Hosted: <code className="rounded bg-muted px-1">npx supabase link</code> then{" "}
          <code className="rounded bg-muted px-1">npx supabase db push</code>.
        </li>
        <li>
          Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
          <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> and (server only){" "}
          <code className="rounded bg-muted px-1">SUPABASE_SERVICE_ROLE_KEY</code>.
        </li>
      </ol>
    </main>
  )
}
