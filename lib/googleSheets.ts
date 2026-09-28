import { google } from "googleapis";
import type { Lead } from "@/lib/supabase/server";

/**
 * Appends/updates a lead row in the agency's Google Sheet.
 *
 * Auth strategy: a single Google Service Account (shared across all
 * tenants) that has been granted "Editor" access to each agency's sheet
 * individually. The service account's credentials live in env vars;
 * the target spreadsheet ID is per-agency (`agencies.google_sheet_id`).
 */

function getServiceAccountAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Vercel env vars can't hold literal newlines cleanly, so the key is
  // stored with escaped "\n" and unescaped here.
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY environment variables."
    );
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

const SHEET_TAB_NAME = "Leads";
const SHEET_RANGE = `${SHEET_TAB_NAME}!A:H`;

/**
 * Appends a new row for this lead. Simpler and safer than trying to find
 * + update an existing row on every message; the sheet becomes an
 * append-only activity log, which most agency ops teams prefer anyway.
 * Swap for a lookup-and-update strategy if you need one row per lead.
 */
export async function syncLeadToGoogleSheet(
  spreadsheetId: string,
  lead: Lead
): Promise<void> {
  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const row = [
      lead.id,
      lead.phone_number,
      lead.full_name ?? "",
      lead.budget ?? "",
      lead.location_preference ?? "",
      lead.property_type ?? "",
      lead.purchase_timeline ?? "",
      lead.status,
      new Date(lead.last_message_at).toISOString(),
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: SHEET_RANGE,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  } catch (err) {
    // Google Sheets sync is best-effort — never fail the buyer-facing
    // request because of a spreadsheet hiccup.
    console.error("[syncLeadToGoogleSheet] failed:", err);
  }
}
