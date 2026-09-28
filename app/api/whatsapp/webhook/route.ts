/**
 * Thin wrapper around the WhatsApp Cloud API "send message" endpoint.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */

const WHATSAPP_GRAPH_VERSION = "v20.0";

interface SendTextMessageParams {
  phoneNumberId: string; // Meta's `metadata.phone_number_id` for this agency's WA number
  to: string; // buyer's phone number, E.164 without '+', e.g. "919876543210"
  body: string;
}

export async function sendWhatsAppTextMessage({
  phoneNumberId,
  to,
  body,
}: SendTextMessageParams): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    throw new Error("Missing WHATSAPP_TOKEN environment variable.");
  }

  const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error("[sendWhatsAppTextMessage] WhatsApp API error:", res.status, errorBody);
      throw new Error(`WhatsApp API responded with ${res.status}`);
    }
  } catch (err) {
    console.error("[sendWhatsAppTextMessage] failed to send message:", err);
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Inbound payload parsing                                                    */
/* -------------------------------------------------------------------------- */

// Minimal typed slice of Meta's webhook payload — extend as needed.
export interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{
          from?: string;
          type?: string;
          text?: { body?: string };
        }>;
        contacts?: Array<{ profile?: { name?: string } }>;
      };
    }>;
  }>;
}

export interface ParsedInboundMessage {
  phoneNumberId: string;
  from: string;
  text: string;
  contactName: string | null;
}

/**
 * Extracts the first text message from a WhatsApp webhook POST body.
 * Returns null if the payload isn't a user text message (e.g. it's a
 * status/delivery callback, which Meta also sends to the same webhook).
 */
export function parseInboundWhatsAppMessage(
  payload: WhatsAppWebhookPayload
): ParsedInboundMessage | null {
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  const phoneNumberId = value?.metadata?.phone_number_id;

  if (!message || !phoneNumberId || message.type !== "text" || !message.text?.body) {
    return null;
  }

  if (!message.from) return null;

  return {
    phoneNumberId,
    from: message.from,
    text: message.text.body,
    contactName: value?.contacts?.[0]?.profile?.name ?? null,
  };
        }
