import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the SERVICE ROLE key.
 *
 * ⚠️ NEVER import this file in client components. It bypasses Row Level
 * Security (RLS) and must only be used inside Route Handlers / Server
 * Actions where we manually enforce `agency_id` tenant isolation on every
 * query.
 */

declare global {
  // eslint-disable-next-line no-var
  var __propelSupabaseAdmin: SupabaseClient | undefined;
}

function createSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Reuse a single client across warm serverless invocations.
export const supabaseAdmin: SupabaseClient =
  globalThis.__propelSupabaseAdmin ?? createSupabaseAdmin();

if (process.env.NODE_ENV !== "production") {
  globalThis.__propelSupabaseAdmin = supabaseAdmin;
}

/* -------------------------------------------------------------------------- */
/* Domain types                                                               */
/* -------------------------------------------------------------------------- */

export type LeadStatus = "PENDING" | "QUALIFIED" | "BOOKED";

export interface Agency {
  id: string;
  name: string;
  whatsapp_phone_number_id: string;
  whatsapp_verify_token: string;
  system_prompt: string;
  google_sheet_id: string | null;
  calendly_link: string | null;
  is_active: boolean;
}

export interface Lead {
  id: string;
  agency_id: string;
  phone_number: string;
  full_name: string | null;
  budget: string | null;
  location_preference: string | null;
  property_type: string | null; // 2BHK / 3BHK / etc.
  purchase_timeline: string | null;
  status: LeadStatus;
  last_message_at: string;
  created_at: string;
}

export interface ConversationMessage {
  id?: string;
  agency_id: string;
  lead_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
}

/* -------------------------------------------------------------------------- */
/* Tenant-safe data access helpers                                           */
/* -------------------------------------------------------------------------- */

/**
 * Resolves an agency strictly by its WhatsApp Phone Number ID (the value
 * Meta sends in the webhook payload's `metadata.phone_number_id`).
 * This is how we map an inbound message to the correct tenant.
 */
export async function getAgencyByPhoneNumberId(
  phoneNumberId: string
): Promise<Agency | null> {
  const { data, error } = await supabaseAdmin
    .from("agencies")
    .select("*")
    .eq("whatsapp_phone_number_id", phoneNumberId)
    .eq("is_active", true)
    .single();

  if (error) {
    // PGRST116 = no rows found, which is an expected "not found" case.
    if ((error as { code?: string }).code === "PGRST116") return null;
    console.error("[getAgencyByPhoneNumberId] Supabase error:", error);
    throw error;
  }

  return data as Agency;
}

/**
 * Fetches an existing lead for this agency + phone number, or creates a
 * fresh PENDING lead if this is the buyer's first inbound message.
 * Every query is scoped by `agency_id` to guarantee tenant isolation.
 */
export async function getOrCreateLead(
  agencyId: string,
  phoneNumber: string
): Promise<Lead> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("agency_id", agencyId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (fetchError) {
    console.error("[getOrCreateLead] fetch error:", fetchError);
    throw fetchError;
  }

  if (existing) return existing as Lead;

  const { data: created, error: insertError } = await supabaseAdmin
    .from("leads")
    .insert({
      agency_id: agencyId,
      phone_number: phoneNumber,
      status: "PENDING" as LeadStatus,
      last_message_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("[getOrCreateLead] insert error:", insertError);
    throw insertError;
  }

  return created as Lead;
}

/** Returns the last N conversation turns for AI context, oldest first. */
export async function getConversationHistory(
  agencyId: string,
  leadId: string,
  limit = 12
): Promise<ConversationMessage[]> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("agency_id", agencyId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[getConversationHistory] error:", error);
    throw error;
  }

  return ((data as ConversationMessage[]) ?? []).reverse();
}

export async function insertConversationMessage(
  message: ConversationMessage
): Promise<void> {
  const { error } = await supabaseAdmin.from("conversations").insert(message);
  if (error) {
    console.error("[insertConversationMessage] error:", error);
    throw error;
  }
}

export async function updateLeadFromQualification(
  agencyId: string,
  leadId: string,
  fields: Partial<
    Pick<
      Lead,
      | "full_name"
      | "budget"
      | "location_preference"
      | "property_type"
      | "purchase_timeline"
      | "status"
    >
  >
): Promise<Lead> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .update({
      ...fields,
      last_message_at: new Date().toISOString(),
    })
    .eq("agency_id", agencyId) // tenant guard
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) {
    console.error("[updateLeadFromQualification] error:", error);
    throw error;
  }

  return data as Lead;
}
