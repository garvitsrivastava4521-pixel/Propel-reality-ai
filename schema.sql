-- =============================================================================
-- Propel Reality AI — Core Multi-Tenant Schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- =============================================================================

create extension if not exists "uuid-ossp";

-- -----------------------------------------------------------------------------
-- agencies: one row per tenant (real estate agency)
-- -----------------------------------------------------------------------------
create table if not exists agencies (
  id                          uuid primary key default uuid_generate_v4(),
  name                        text not null,
  whatsapp_phone_number_id    text not null unique, -- Meta's per-number ID; primary tenant key for inbound routing
  whatsapp_verify_token       text not null,        -- optional per-agency token, checked at the application layer
  system_prompt               text not null default 'You are a friendly, professional real estate assistant.',
  google_sheet_id             text,                 -- target spreadsheet for lead sync
  calendly_link               text,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_agencies_phone_number_id on agencies (whatsapp_phone_number_id);

-- -----------------------------------------------------------------------------
-- leads: one row per (agency, buyer phone number)
-- -----------------------------------------------------------------------------
create table if not exists leads (
  id                          uuid primary key default uuid_generate_v4(),
  agency_id                   uuid not null references agencies(id) on delete cascade,
  phone_number                text not null,
  full_name                   text,
  budget                      text,
  location_preference         text,
  property_type               text,
  purchase_timeline           text,
  status                      text not null default 'PENDING' check (status in ('PENDING', 'QUALIFIED', 'BOOKED')),
  last_message_at             timestamptz not null default now(),
  created_at                  timestamptz not null default now(),

  -- A phone number is only unique WITHIN a given agency — the same buyer
  -- could message two different agencies and should get two separate leads.
  constraint uq_leads_agency_phone unique (agency_id, phone_number)
);

create index if not exists idx_leads_agency_id on leads (agency_id);
create index if not exists idx_leads_agency_status on leads (agency_id, status);

-- -----------------------------------------------------------------------------
-- conversations: append-only message log per lead
-- -----------------------------------------------------------------------------
create table if not exists conversations (
  id                          uuid primary key default uuid_generate_v4(),
  agency_id                   uuid not null references agencies(id) on delete cascade,
  lead_id                     uuid not null references leads(id) on delete cascade,
  role                        text not null check (role in ('user', 'assistant', 'system')),
  content                     text not null,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_conversations_agency_lead on conversations (agency_id, lead_id, created_at);

-- -----------------------------------------------------------------------------
-- calendly_bookings: raw log of every Calendly onEventScheduled callback
-- -----------------------------------------------------------------------------
create table if not exists calendly_bookings (
  id                          uuid primary key default uuid_generate_v4(),
  invitee_name                text,
  invitee_email                text,
  event_uri                    text,
  raw_payload                  jsonb,
  created_at                   timestamptz not null default now()
);

-- =============================================================================
-- Row Level Security
--
-- The Route Handlers in this project use the SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS by design (tenant isolation is enforced in
-- application code via explicit `.eq("agency_id", ...)` filters on every
-- query — see lib/supabase/server.ts).
--
-- RLS is still enabled + locked down below as defense-in-depth, in case
-- these tables are ever queried with the anon/public key (e.g. from a
-- future agency-facing dashboard using Supabase Auth). Adjust the policies
-- to match your auth model (e.g. a `user_agency_map` table linking
-- `auth.uid()` to `agency_id`) before exposing these tables client-side.
-- =============================================================================

alter table agencies enable row level security;
alter table leads enable row level security;
alter table conversations enable row level security;
alter table calendly_bookings enable row level security;

-- No public/anon policies are defined — by default this blocks ALL access
-- except via the service role key. Add scoped SELECT/INSERT policies here
-- once you build an authenticated agency dashboard, e.g.:
--
-- create policy "Agencies can read their own leads"
--   on leads for select
--   using (agency_id = (select agency_id from user_agency_map where user_id = auth.uid()));

-- -----------------------------------------------------------------------------
-- updated_at trigger for agencies
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_agencies_updated_at on agencies;
create trigger trg_agencies_updated_at
  before update on agencies
  for each row
  execute function set_updated_at();
