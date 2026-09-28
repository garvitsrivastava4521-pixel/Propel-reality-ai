# Propel Reality AI — Backend Engine

## File structure delivered

```
app/api/whatsapp/webhook/route.ts   # GET verify + POST inbound message handler
app/api/calendly/booking/route.ts   # Receives onEventScheduled payload, logs booking
lib/supabase/server.ts              # Tenant-safe Supabase service-role client + queries
lib/openai/qualifyLead.ts           # GPT-4o-mini/4o lead qualification engine
lib/integrations/whatsapp.ts        # WhatsApp Cloud API send + payload parsing
lib/integrations/googleSheets.ts    # Google Sheets sync (per-agency spreadsheet)
components/CalendlyBooking.tsx      # Inline Calendly widget + event listener
supabase/schema.sql                 # agencies / leads / conversations / calendly_bookings + RLS
.env.local                          # Your real credentials — gitignored, never commit this
.gitignore                          # Excludes .env* from version control
```

## Required packages

```bash
npm install openai@^4 @supabase/supabase-js googleapis react-calendly
```

## Using the Calendly booking section

Drop `<CalendlyBooking />` into any page or layout, e.g.:

```tsx
import CalendlyBooking from "@/components/CalendlyBooking";

export default function BookingPage() {
  return <CalendlyBooking />;
}
```

- Points at `https://calendly.com/garvitsrivastava4521/30min` (your original
  URL had `https://calendly.com/` duplicated — fixed here).
- `onEventScheduled` logs `e.data.payload` to the browser console and POSTs
  it to `app/api/calendly/booking/route.ts`, which writes a row to the new
  `calendly_bookings` table.
- Matching a Calendly booking back to a specific `lead_id`/`agency_id` isn't
  done automatically — Calendly's payload only reliably gives you the
  invitee's name/email, not your internal IDs. The route has a commented-out
  example showing how to pass `lead_id` through as a Calendly UTM param
  (`?utm_content=<lead_id>`) and read it back to flip that lead to `BOOKED`.

`next`, `react`, `typescript` assumed already installed via `create-next-app` (App Router, TS).

## ⚠️ Security note on `.env.local`

This file now contains your real Supabase, OpenAI, Gemini, and NOWPayments
credentials, filled in from what you provided. Before doing anything else:

1. Confirm `.env.local` is listed in `.gitignore` (it is, by default here) —
   never let it reach a git commit or a public repo.
2. Because these values were pasted into this chat, treat them as
   **potentially exposed** and rotate/regenerate them from each provider's
   dashboard (Supabase → Project Settings → API; OpenAI → API keys; etc.),
   especially the Supabase `service_role` key, which has unrestricted
   database access.
3. Copy the rotated values into `.env.local` for local dev, and into the
   Vercel Dashboard's Environment Variables for deployment — never into any
   `.ts`/`.tsx` source file.

Gemini and NOWPayments keys are stored as env vars but aren't wired into any
route yet in this codebase — add that integration code when you're ready to
use them, referencing `process.env.GEMINI_API_KEY` / `process.env.NOWPAYMENTS_API_KEY`.

## Environment variables

Set these in `.env.local` for development and in the Vercel Dashboard
(Project → Settings → Environment Variables) for Preview/Production.

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | `lib/supabase/server.ts` | Project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/server.ts` | **Server-only.** Never expose to the client/browser. |
| `OPENAI_API_KEY` | `lib/openai/qualifyLead.ts` | Tiered paid key with access to `gpt-4o-mini` / `gpt-4o` |
| `WHATSAPP_TOKEN` | `lib/integrations/whatsapp.ts` | Permanent system-user access token from Meta App Dashboard |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | `app/api/whatsapp/webhook/route.ts` | Arbitrary string you choose; must match what you enter in the Meta webhook config screen |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `lib/integrations/googleSheets.ts` | From the GCP service account JSON |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | `lib/integrations/googleSheets.ts` | From the GCP service account JSON; keep `\n` escaped as literal `\n` in the Vercel dashboard field |

Per-agency values (`whatsapp_phone_number_id`, `system_prompt`,
`google_sheet_id`, `calendly_link`, etc.) live in the `agencies` table, not
in env vars — that's what makes the platform multi-tenant.

## Multi-tenant isolation model

- Inbound WhatsApp messages are routed to a tenant via
  `metadata.phone_number_id` in Meta's webhook payload → matched against
  `agencies.whatsapp_phone_number_id`.
- Every subsequent Supabase query (`leads`, `conversations`) is explicitly
  filtered by `agency_id` in `lib/supabase/server.ts` — there is no query in
  this codebase that reads/writes those tables without that filter.
- `leads` has a `unique (agency_id, phone_number)` constraint, so the same
  buyer phone number messaging two different agencies produces two
  independent lead records.
- RLS is enabled on all three tables as defense-in-depth for when you build
  an authenticated agency-facing dashboard later; see comments in
  `schema.sql` for how to add scoped policies at that point.

## Wiring it together in the Meta App Dashboard

1. WhatsApp → Configuration → Webhook → Callback URL:
   `https://<your-vercel-domain>/api/whatsapp/webhook`
2. Verify token: whatever you set as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
3. Subscribe to the `messages` field.
4. For each agency you onboard, create/verify a WhatsApp phone number in
   Meta Business Manager, grab its `phone_number_id`, and insert a row into
   `agencies` with that value.

## Known trade-offs (documented, not hidden)

- The Google Sheets sync is **append-only** (one row per sync event) rather
  than find-and-update-in-place, to avoid extra read round-trips on every
  message. Swap `syncLeadToGoogleSheet` for a lookup-by-`lead.id`-then-update
  strategy if you need exactly one row per lead.
- The webhook's `POST` handler always returns HTTP 200, even on internal
  errors, so Meta doesn't retry-storm a transient failure — errors are
  logged via `console.error` for you to pipe into Vercel Logs / Sentry.
- OpenAI failures fall back to a safe "technical hiccup" reply instead of
  breaking the buyer's conversation thread.
