import OpenAI from "openai";
import type { ConversationMessage, Lead, LeadStatus } from "@/lib/supabase/server";

let _client: OpenAI | undefined;

function getOpenAIClient(): OpenAI {
  if (_client) return _client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * Shape returned by the model. We force this via `response_format:
 * { type: "json_object" }` plus an explicit schema description in the
 * system prompt, then defensively re-validate before touching the DB.
 */
export interface QualificationResult {
  reply_text: string;
  status: LeadStatus;
  extracted: {
    full_name: string | null;
    budget: string | null;
    location_preference: string | null;
    property_type: string | null; // e.g. "2BHK", "3BHK", "Villa"
    purchase_timeline: string | null; // e.g. "Immediate", "1-3 months", "3-6 months"
  };
}

const RESPONSE_SCHEMA_HINT = `
Respond with ONLY a valid JSON object (no markdown, no commentary) matching exactly:
{
  "reply_text": string,           // The message to send back to the buyer on WhatsApp
  "status": "PENDING" | "QUALIFIED" | "BOOKED",
  "extracted": {
    "full_name": string | null,
    "budget": string | null,
    "location_preference": string | null,
    "property_type": string | null,
    "purchase_timeline": string | null
  }
}

Rules for "status":
- "PENDING": still missing one or more of budget, location_preference, property_type, or purchase_timeline.
- "QUALIFIED": all four fields above are known with reasonable confidence.
- "BOOKED": the buyer has explicitly agreed to schedule/confirm a site visit or call.
`.trim();

function buildSystemPrompt(agencySystemPrompt: string, calendlyLink: string | null): string {
  return [
    agencySystemPrompt?.trim() ||
      "You are a friendly, professional 24/7 real estate assistant for a property agency.",
    "",
    "Your job on every message:",
    "1. Continue a natural, concise WhatsApp conversation with a property buyer.",
    "2. Politely collect: budget, preferred location, property type (2BHK/3BHK/etc.), and purchase timeline.",
    "3. Never invent facts about specific properties/pricing you have not been given.",
    "4. Once all four fields are known, summarize them back to the buyer for confirmation and invite them to book a call/site visit.",
    calendlyLink
      ? `5. When the buyer agrees to book, share this scheduling link: ${calendlyLink}`
      : "5. When the buyer agrees to book, tell them a human agent will share a scheduling link shortly.",
    "",
    RESPONSE_SCHEMA_HINT,
  ].join("\n");
}

/**
 * Runs the qualification turn: takes conversation history + the buyer's
 * latest message, returns the AI's reply text plus structured lead data.
 */
export async function runLeadQualification(params: {
  agencySystemPrompt: string;
  calendlyLink: string | null;
  history: ConversationMessage[];
  latestMessage: string;
  currentLead: Lead;
  model?: "gpt-4o-mini" | "gpt-4o";
}): Promise<QualificationResult> {
  const {
    agencySystemPrompt,
    calendlyLink,
    history,
    latestMessage,
    currentLead,
    model = "gpt-4o-mini",
  } = params;

  const client = getOpenAIClient();

  const knownFieldsContext = `
Known lead data so far (may be incomplete — fill gaps, don't discard known values unless corrected):
${JSON.stringify(
  {
    full_name: currentLead.full_name,
    budget: currentLead.budget,
    location_preference: currentLead.location_preference,
    property_type: currentLead.property_type,
    purchase_timeline: currentLead.purchase_timeline,
  },
  null,
  2
)}
`.trim();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(agencySystemPrompt, calendlyLink) },
    { role: "system", content: knownFieldsContext },
    ...history.map(
      (m): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })
    ),
    { role: "user", content: latestMessage },
  ];

  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<QualificationResult>;

    return validateAndNormalize(parsed);
  } catch (err) {
    console.error("[runLeadQualification] OpenAI error:", err);
    // Fail safe: keep the conversation alive even if the model call errors.
    return {
      reply_text:
        "Sorry, I'm having a brief technical hiccup on my end — could you repeat that for me?",
      status: currentLead.status,
      extracted: {
        full_name: currentLead.full_name,
        budget: currentLead.budget,
        location_preference: currentLead.location_preference,
        property_type: currentLead.property_type,
        purchase_timeline: currentLead.purchase_timeline,
      },
    };
  }
}

function validateAndNormalize(parsed: Partial<QualificationResult>): QualificationResult {
  const validStatuses: LeadStatus[] = ["PENDING", "QUALIFIED", "BOOKED"];
  const status: LeadStatus = validStatuses.includes(parsed.status as LeadStatus)
    ? (parsed.status as LeadStatus)
    : "PENDING";

  return {
    reply_text:
      typeof parsed.reply_text === "string" && parsed.reply_text.trim().length > 0
        ? parsed.reply_text
        : "Thanks for the message! Could you tell me a bit more about what you're looking for?",
    status,
    extracted: {
      full_name: parsed.extracted?.full_name ?? null,
      budget: parsed.extracted?.budget ?? null,
      location_preference: parsed.extracted?.location_preference ?? null,
      property_type: parsed.extracted?.property_type ?? null,
      purchase_timeline: parsed.extracted?.purchase_timeline ?? null,
    },
  };
    }
