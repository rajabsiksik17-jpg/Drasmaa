# Clinic EMR — Gynecology · Fertility/IVF · Pregnancy

A bilingual (English / Arabic RTL) clinic management system that digitizes the clinic's paper charts —
History & Examination, Pregnancy follow-up card, Ovulation Induction (O/I) chart, IVF couple consent —
into live, autosaving forms backed by PostgreSQL with row-level security, realtime updates and a full audit trail.

**Stack:** Next.js 16 (App Router, Server Components, Server Actions) · React 19 · TypeScript · Supabase
(Postgres, Auth, Realtime, Storage) · Tailwind CSS 4 + shadcn/ui · next-intl · TanStack Query ·
React Hook Form + Zod · date-fns (Asia/Amman) · Konva (ultrasound drawing) · Motion.

## Getting started

```bash
cp .env.example .env.local          # fill in your Supabase URL + keys
npx supabase start                  # local Postgres/Auth/Storage/Realtime (needs Docker)
npx supabase db reset               # applies supabase/migrations + supabase/seed.sql
npm run dev
```

Hosted Supabase instead: `npx supabase link --project-ref <ref>` then `npx supabase db push`
(the seed file is for development only — do not load it into production).

Development logins created by `seed.sql` (password `ClinicDev#2026`):
`admin@clinic.test`, `doctor@clinic.test`, `gyn@clinic.test`, `desk@clinic.test`.

Without Supabase configured, the app shows `/setup`. In development, `/dev/forms` previews the paper
forms with fictional data (nothing is saved; the route 404s in production).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | All tests (unit + database) |
| `npm run test:db` | Runs every migration in an embedded Postgres (PGlite) and tests RLS, triggers and RPCs |
| `npm run typecheck` / `lint` | TypeScript / ESLint (incl. React Compiler rules) |
| `npm run i18n:check` | Lists translation keys used in code but missing from `messages/*.json` |

## Architecture

```
supabase/migrations   0001 core (roles, permissions, config) · 0002 patients · 0003 appointments,
                      reminders, notifications · 0004 clinical (visits, cases, O/I cycles, investigations,
                      documents) · 0005 audit, timeline, search · 0006 RLS · 0007 storage, realtime, cron
                      0008/0009 doctor assignment + create_patient · 0010 communication (notification
                      engine, templates, email, communication log, reminder engine) · 0011 security
                      (session registry, OTP, login/security logs, rate limits) · 0012 generated
                      documents · 0013 built-in message templates · 0014 center information,
                      pricing catalog, invoices, payments, cash register · 0015 ultrasound images &
                      drawings, medication catalog, prescriptions, medical reports, report templates
src/lib/accounting    date ranges, accounting reports (PDF/CSV) — totals are computed only in the DB
src/lib/drawing       drawing shapes, eraser hit-testing (Konva editor + exact SVG for print/PDF)
src/lib/security      encryption (AES-256-GCM), OTP, device cookie, rate limiting, security logs
src/lib/email         SMTP (nodemailer) / IMAP (imapflow) with encrypted credentials
src/lib/messaging     template variables, WhatsApp number normalization + click-to-chat links
src/lib/pdf           headless Chromium PDF renderer · src/lib/documents (document registry, file names)
src/lib/jobs          background jobs (reminders, email outbox, retention) — run every minute in-process
src/lib/actions       Server Actions — every one re-checks permissions; RLS enforces them again in the DB
src/lib/data          Server-side loaders used by Server Components
src/hooks/use-record  Autosave engine: debounce, version check, realtime merge, conflict detection
src/components        layout · patients · appointments · visits · medical (paper forms) · oi · pregnancy · admin
messages/             en.json, ar.json (identical key sets, enforced by tests)
```

### Key rules implemented in the database

- **Single source of truth.** Patient-level history lives in `patient_*` tables (one row per patient).
  Visits, pregnancy cases and O/I cycles store *snapshots* (e.g. hormones imported into a cycle keep a
  `source_result_id`; editing the chart never changes the lab history).
- **History is never silently rewritten.** Completed visits, completed/cancelled cycles, earlier pregnancy
  follow-up rows and earlier lab results can only be corrected with a reason (`x-audit-reason` header →
  `request_audit_reason()`); the database refuses the change otherwise. Every insert/update is written to
  the immutable `audit_logs` (before/after/changed fields/actor/reason).
- **Optimistic concurrency.** Every mutable row has a `version`; saves are `UPDATE … WHERE version = n`.
  A mismatch is surfaced as "This record was updated by another user" with Reload / Review / Continue.
- **Appointments.** Controlled state machine (`scheduled → checked_in → with_doctor → completed`,
  plus `cancelled`, `no_show`, `rescheduled`); double-booking a doctor is blocked by an exclusion
  constraint; rescheduling keeps the old row (`rescheduled`) and creates a new one atomically.
- **Reminders.** Each appointment gets a reminder row due the day before (Asia/Amman). Due reminders become
  notifications for users with `appointments.reminders`; cancelling/rescheduling voids them.
  Processing runs from triggers (same-day bookings for tomorrow), `pg_cron` every 15 min when available,
  or `GET /api/cron/reminders` with `CRON_SECRET`.
- **RBAC + RLS.** Permissions (e.g. `medical_history.edit`, `oi.edit`, `appointments.checkin`) are granted to
  roles in Admin → Roles; `has_permission()` and `can_access_patient()` (scope: all / department / assigned)
  are used by every policy. Receptionists see administrative data, allergy warnings and recent visit metadata only.
- **Documents.** Private bucket `patient-documents/<patient_id>/<uuid>.<ext>`; signed upload URL →
  verified → registered (orphans removed); viewing uses 120-second signed URLs.

## Assumptions (documented decisions)

- Language is a per-user preference (cookie + `profiles.locale`) rather than a URL segment, so switching
  language keeps the user on the same screen and never changes data.
- "CPC" in the investigation list is treated as CBC. Sections 58/59 (family history) are one record.
- Paper-form wording is preserved, except the obvious typo "Menestrual" → "Menstrual" and "Protocole" → "Protocol".
- The ultrasound template (`public/templates/pelvis_v1.svg`) is a generic schematic; replace the file with the
  clinic's own template (same name) to change it — drawings are stored as a separate vector layer.
- The clinic logo/name on printed forms comes from Admin → Clinic settings (no hard-coded letterhead).
- Required fields to *complete* a visit: pregnancy → date + blood pressure; fertility → primary plan;
  gynecology → complaint. Drafts can always be saved incomplete (`visit_missing_fields()`).
- The system never recommends treatment: plans are chosen by the doctor.

## Known limitations

- Browser **Back** with unsaved edits: edits are flushed on unmount (and `beforeunload` warns on tab
  close/refresh; in-app links show Save / Leave / Cancel), but Back itself is not intercepted.
- Native date pickers display in the browser's locale (dd/mm on en-GB / Arabic browsers, mm/dd on en-US).
- No offline mode: when offline the UI says so and nothing is reported as saved.
- SMS / WhatsApp / email reminders are not implemented (internal notifications only); the reminder table is
  the extension point.
- PDF output uses the browser's "Save as PDF" from the A4 print views.

## Communication, notifications & security

- **Notification center** — categories (appointments, patients, medical, security, admin, system) and
  priorities (low/normal/high/critical) come from `notification_event_types`; administrators switch events
  and the email channel on/off (Admin → Notifications); users can mute non-critical events (Settings).
  Critical security events can't be muted. Texts never contain clinical details.
- **Email** — Admin → Email stores SMTP/IMAP settings; passwords are encrypted with `APP_ENCRYPTION_KEY`
  on the server and the database column privileges make the ciphertext unreadable for signed-in users.
  "Test connection" checks SMTP connect/auth, sends a real test email and checks IMAP connect/auth.
- **Message templates** — email and WhatsApp, Arabic + English, `{{variables}}`, preview with sample data,
  test send, every save kept as a version (restore = new version), built-ins can't be deleted.
- **WhatsApp** — prepared messages only: the number is normalized on the server (Jordan `079…` →
  `96279…`, no duplicated `962`), the message is logged as *Prepared* and *Opened* — never "Delivered".
- **Appointment reminders** — configurable 24 h / 12 h / 2 h / 1 h rules per channel (in-app, patient
  email, WhatsApp-ready notification). Only the latest due threshold fires; nothing is sent twice.
- **OTP sign-in** — Admin → Authentication: disabled / new device / every sign-in, for all or selected roles.
  6-digit codes are random, HMAC-hashed, single-use, expire, are attempt- and resend-limited.
- **Sessions** — every Supabase session must be registered and *active* in `user_sessions`;
  `has_permission()` checks this, so a session waiting for its OTP or a revoked session cannot read any data
  even through the database API. Users manage their sessions in Settings → Security; administrators in
  Admin → Sessions. New-device logins raise a security notification (optionally email).
- **Security center** — status checks, sessions, recent/failed sign-ins and security events.
- **Rate limits** — sign-in (per IP and per email + temporary lockout), OTP verify/resend, password reset,
  email sending, uploads, patient registration and PDF generation.
- **Headers** — strict nonce-based CSP, HSTS (production), frame-ancestors 'self', nosniff, referrer policy.

## Documents & PDF export

- Export menus on the patient profile (**Share**), visits, pregnancy cases, O/I cycles, fertility cases,
  investigations, timeline, medical history and appointments: *Export PDF · Print · WhatsApp · Email*.
- PDFs are produced by headless Chromium from the same print views (real, selectable text; Cairo/Arabic
  shaping; RTL; A4 portrait/landscape; repeated table headers; page numbers). Paper-form documents keep
  their paper layout. Patient summaries let the user choose sections (each section re-checked server-side).
- Each generation is an immutable snapshot (`generated_documents`, SHA-256, version number) stored privately
  under `<patient_id>/generated/<yyyy>/<mm>/<uuid>.pdf`, downloaded only through
  `/api/generated-documents/<id>` after an RLS check (no public or long-lived URLs, no IDOR). File names
  follow `{patient}_{document_type}_{YYYY-MM-DD}_{HH-mm}.pdf`.
- WhatsApp sharing downloads the PDF and opens WhatsApp Web/app with the prepared message (a normal web app
  cannot attach files to WhatsApp); on phones the native share sheet is offered. Email sharing attaches the
  PDF and is recorded as *Sent* only when the SMTP server accepted it.
- Every generation, view, download, print, share and deletion is written to `document_access_logs`.
- Admin → Document templates: header, logo, patient block, doctor info, optional doctor signature (only on
  documents that doctor generates), footer, margins, orientation and optional retention of exported files.

## Accounting, prescriptions, reports & drawings

- **Center information** (Admin → Clinic) is the single source of truth for every document: names, logos,
  contacts, address, maps link, license, main doctor, header/footer texts per document kind, currency and
  numbering prefixes (`INV/RCT/MED/RX-YYYY-000001`, gap-free per year, never reused).
- **Pricing** (Admin → Pricing): services with cash and insurance prices, per-insurer prices, billable and
  insurance-eligible flags, default service per appointment type, automatic triggers (ultrasound, report,
  certificate) and packages. Price changes are logged in `service_price_history`; invoice lines keep a
  snapshot of the price actually charged.
- **Billing is derived from clinical work**: completing a visit creates/updates the appointment invoice
  (plus ultrasound when one is recorded); finalizing a report or certificate adds its service. Nothing is
  charged twice; appointments can be marked *no charge*.
- **Checkout** (appointment, patient header or Accounting → Invoices): totals, discounts (percent/fixed,
  `accounting.discount`, reason required), insurance/patient split, cash/insurance/mixed payments with several
  methods. Payments are append-only; refunds are separate linked rows; void requires no payments and a reason.
- **Daily cash register**: opening balance, cash in, refunds, expenses, expected vs counted cash. A closed day
  is immutable — corrections are adjustments with a reason. Cash payments on a closed day are rejected.
- **Accounting dashboard & reports**: KPIs and breakdowns (doctor, service, method, insurance, daily) for
  today/yesterday/week/month/custom; 12 reports exportable as PDF, CSV (formula-injection safe) and print.
  Financial privacy is access control only — every real transaction stays complete and auditable.
- **Ultrasound images & drawings** (visit → Ultrasound images & drawings, also used for fertility/pregnancy):
  upload/camera images or diagram templates, pen/marker/highlighter/line/arrow/circle/rectangle/text, object
  eraser, colors, undo/redo, zoom/pinch/pan, mouse/touch/stylus. The original image is never modified;
  shapes are stored as data, older versions are kept, and drawings appear in visit PDFs and the timeline.
- **Prescriptions**: inline items (medication, dose, route, frequency, duration, quantity, instructions) with
  suggestions only from the configured medication catalog (Admin → Medications). Completing the visit issues
  the prescription; issued prescriptions are immutable (cancel with reason, or copy as new).
- **Medical reports** (sidebar → Reports): for registered patients (prefilled) or any person (no fake patient
  file; can be linked to a patient later), Arabic/English/bilingual, editable templates with variables,
  identity snapshot, version history after finalization, filters, and View/Edit/Duplicate/PDF/Print/WhatsApp/Email.
- New permissions: `accounting.*`, `pricing.*`, `reports.*`, `prescriptions.*`, `medications.manage`,
  `drawings.*`, enforced by RLS and server actions (not by the UI alone).

## Deployment (production checklist)

1. `npx supabase link --project-ref <ref>` and `npx supabase db push` (applies all migrations; no seed).
2. Environment variables (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, `APP_URL`.
3. `npm ci && npm run build && npm start` on Node 20+ (long-running process: background jobs run in-process).
   PDF generation uses Chrome/Chromium on the server (`CHROME_PATH`) or the bundled `@sparticuz/chromium`
   (Linux x64).
4. Supabase Auth → URL configuration: Site URL `https://<domain>`, redirect URL `https://<domain>/auth/confirm`.
   Keep Supabase's own auth rate limits enabled.
5. Configure Admin → Email and run "Test connection" before enabling OTP.
6. Infrastructure: HTTPS only (TLS), a reverse proxy / WAF in front of the app, the database never exposed
   publicly (only Supabase/the app talk to it), SSH keys instead of passwords, firewall with only 80/443 open,
   Fail2ban or equivalent, automatic security updates, encrypted daily backups (Supabase PITR), monitoring
   and log rotation, secrets only in the host's environment settings — never in Git.
