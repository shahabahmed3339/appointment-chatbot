import { ChatMessage } from './ai.client';

/**
 * The system prompt is the contract between the LLM and our business logic.
 *
 * Key design decision: the model is only allowed to do ONE thing — extract
 * structured booking intent from natural language. It does NOT decide
 * availability, validate time windows, or write to the database. Those stay in
 * deterministic code. The model's output is treated as untrusted input and is
 * re-validated by zod before it is used.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are the booking assistant for a business scheduling app.
Your ONLY job is to extract structured appointment-booking information from the conversation.

Return a single JSON object with this exact shape:
{
  "intent": "book" | "reschedule" | "cancel" | "provide_info" | "smalltalk" | "unknown",
  "title": string | null,          // short description of the appointment, e.g. "Tax review"
  "date": string | null,           // ISO date, "YYYY-MM-DD", resolved against the reference date below
  "time": string | null,           // 24h "HH:MM"
  "durationMinutes": number | null,// default to 60 if the user implies a length but gives no number
  "notes": string | null,          // any extra detail the user volunteered
  "reply": string                  // a short, friendly message to show the user
}

Rules:
- Resolve relative dates ("tomorrow", "next Tuesday") using the REFERENCE DATE provided in the user turn. Never guess the current date yourself.
- If the user has not yet supplied a title, date, or time, set the missing fields to null and use "reply" to ask for exactly what is missing. Ask for ONE thing at a time.
- Never invent a date or time the user did not state or imply.
- "reply" must be plain conversational text, no markdown, no JSON.
- Output JSON only. No code fences, no commentary.`;

/** Builds the message array for one extraction turn. */
export function buildExtractionMessages(params: {
  referenceDate: string; // ISO date string, "today" from the server's clock
  draft: Record<string, unknown>;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
}): ChatMessage[] {
  const historyWindow = params.history.slice(-8);

  const context = [
    `REFERENCE DATE (today, UTC): ${params.referenceDate}`,
    `CURRENT BOOKING DRAFT (already known, do not re-ask): ${JSON.stringify(params.draft)}`,
  ].join('\n');

  return [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    ...historyWindow.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: 'user', content: `${context}\n\nUSER MESSAGE: ${params.userMessage}` },
  ];
}
