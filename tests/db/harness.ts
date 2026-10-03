/**
 * Runs the real Supabase migrations inside PGlite (Postgres compiled to
 * WASM) with minimal stand-ins for the Supabase-managed `auth` and
 * `storage` schemas, so RLS policies, triggers and RPCs are exercised
 * against a genuine Postgres engine.
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create table auth.sessions (id uuid primary key, user_id uuid);

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner_id text
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant all on all tables in schema storage to authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`

export type Db = PGlite & {
  as<T>(userId: string | null, fn: () => Promise<T>, reason?: string, sessionId?: string): Promise<T>
}

/** Default (registered, active) session per test user. */
export const sessions = new Map<string, string>()

export async function createDb(): Promise<Db> {
  const db = (await PGlite.create({ extensions: { pg_trgm, btree_gist } })) as unknown as Db
  await db.exec(SUPABASE_STUBS)
  const dir = path.join(__dirname, "..", "..", "supabase", "migrations")
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(path.join(dir, file), "utf8"))
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
    }
  }
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role;")

  db.as = async (userId, fn, reason, sessionId) => {
    await db.exec("begin")
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(
          userId ? { sub: userId, role: "authenticated", session_id: sessionId ?? sessions.get(userId) ?? null } : {},
        ),
      ])
      await db.query("select set_config('app.audit_reason', $1, true)", [reason ?? ""])
      await db.exec("set local role authenticated")
      const result = await fn()
      await db.exec("commit")
      return result
    } catch (error) {
      await db.exec("rollback")
      throw error
    }
  }
  return db
}

export async function createUser(
  db: PGlite,
  opts: { email: string; role: "admin" | "doctor" | "receptionist"; name: string },
) {
  const id = crypto.randomUUID()
  await db.query(
    "insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3, $4)",
    [id, opts.email, JSON.stringify({ role: opts.role }), JSON.stringify({ full_name: opts.name })],
  )
  const sessionId = crypto.randomUUID()
  await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [sessionId, id])
  await db.query("insert into public.user_sessions (id, user_id, status) values ($1, $2, 'active')", [sessionId, id])
  sessions.set(id, sessionId)
  return id
}
