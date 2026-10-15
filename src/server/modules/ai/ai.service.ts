import { callLlm, activeProviderInfo, FailureReason } from './ai.client';
import { buildExtractionMessages } from './extraction.prompt';
import { parseExtraction, ExtractionResult } from './extraction.schema';
import { logger } from '@/server/lib/logger';
import { chatRepository } from '../chat/chat.repository';

export interface BookingDraft {
  title: string | null;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
  durationMinutes: number | null;
  notes: string | null;
}

export interface TurnOutcome {
  reply: string;
  intent: ExtractionResult['intent'];
  draft: BookingDraft;
  /** Fields the assistant still needs before a booking can be created. */
  missing: Array<keyof BookingDraft>;
  /** True when title + date + time are all present and a booking can be confirmed. */
  readyToBook: boolean;
  aiAvailable: boolean;
  /** Which provider answered (or was attempted). Useful for diagnostics. */
  provider: string;
  model: string;
  /**
   * Why the LLM path failed, when it did. Lets the UI distinguish "no key
   * configured" from "provider is rate-limiting us" from "provider is down" —
   * three situations with three different fixes.
   */
  aiErrorReason?: FailureReason;
}

const EMPTY_DRAFT: BookingDraft = {
  title: null,
  date: null,
  time: null,
  durationMinutes: null,
  notes: null,
};

function mergeDraft(current: Partial<BookingDraft>, incoming: ExtractionResult): BookingDraft {
  return {
    title: incoming.title ?? current.title ?? null,
    date: incoming.date ?? current.date ?? null,
    time: incoming.time ?? current.time ?? null,
    durationMinutes: incoming.durationMinutes ?? current.durationMinutes ?? 60,
    notes: incoming.notes ?? current.notes ?? null,
  };
}

function computeMissing(draft: BookingDraft): Array<keyof BookingDraft> {
  const missing: Array<keyof BookingDraft> = [];
  if (!draft.title) missing.push('title');
  if (!draft.date) missing.push('date');
  if (!draft.time) missing.push('time');
  return missing;
}

function fallbackReply(missing: Array<keyof BookingDraft>): string {
  if (missing.length === 0) {
    return 'Great — I have everything I need. Shall I book that for you?';
  }
  const asks: Record<string, string> = {
    title: 'what the appointment is for',
    date: 'which day works for you',
    time: 'what time you would prefer',
  };
  const parts = missing.map((m) => asks[m] ?? String(m));
  return `I can help with that. Could you tell me ${parts.join(' and ')}?`;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Deterministic fallback extractor.
 *
 * Runs ONLY when the LLM is unavailable (no key, outage, or unparseable reply).
 * It deliberately handles just the unambiguous patterns — ISO dates, explicit
 * times, "next <weekday>", and durations. Anything fuzzier returns null so the
 * assistant asks a clarifying question rather than silently guessing wrong.
 * That bias toward false-negatives is intentional: a wrong booking is worse
 * than one extra turn of conversation.
 */
function heuristicExtract(
  message: string,
  referenceDate: string,
): { title: string | null; date: string | null; time: string | null; durationMinutes: number | null } {
  const text = message.toLowerCase();
  let date: string | null = null;
  let time: string | null = null;
  let durationMinutes: number | null = null;

  // ISO date: 2027-04-15
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const [refY, refM, refD] = referenceDate.split('-').map(Number);
  const ref = new Date(Date.UTC(refY, refM - 1, refD));

  // "next tuesday" / "on friday"
  if (!date) {
    const wd = text.match(/\b(?:next\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (wd) {
      const target = WEEKDAYS[wd[1]];
      const delta = ((target - ref.getUTCDay()) + 7) % 7 || 7;
      const d = new Date(ref.getTime() + delta * 86_400_000);
      date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  }

  // "april 15" / "15 april"
  if (!date) {
    const md = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/)
      ?? text.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
    if (md) {
      const monthName = MONTHS[md[1]] !== undefined ? md[1] : md[2];
      const dayNum = MONTHS[md[1]] !== undefined ? md[2] : md[1];
      const month = MONTHS[monthName];
      const day = Number(dayNum);
      let year = refY;
      // Roll to next year if the date has already passed this year.
      const candidate = new Date(Date.UTC(year, month, day));
      if (candidate.getTime() < ref.getTime()) year += 1;
      date = `${year}-${pad(month + 1)}-${pad(day)}`;
    }
  }

  // "tomorrow" / "today" — resolved against the reference date.
  if (!date) {
    if (/\btomorrow\b/.test(text)) {
      const d = new Date(ref.getTime() + 86_400_000);
      date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    } else if (/\btoday\b/.test(text)) {
      date = referenceDate;
    }
  }

  // "14:00", "2pm", "2:30 pm"
  const t24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const t12 = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/);
  if (t24) {
    time = `${pad(Number(t24[1]))}:${t24[2]}`;
  } else if (t12) {
    let hour = Number(t12[1]) % 12;
    if (t12[3] === 'pm') hour += 12;
    time = `${pad(hour)}:${t12[2] ?? '00'}`;
  }

  // "for 90 minutes" / "90 min"
  const dur = text.match(/\b(\d{2,3})\s*(?:minutes|min\b|mins\b)/);
  if (dur) durationMinutes = Number(dur[1]);

  // Title: remove date/time/duration noise FIRST, then take what's left.
  // Doing the strip first matters — otherwise "for 90 minutes" is captured as
  // the title, and weekday names leak into the result.
  let title: string | null = null;
  const withoutNoise = message
    // clock times in either form: 14:00, 2pm, 2:30 pm
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, ' ')
    // explicit durations
    .replace(/\b\d{1,3}\s*(?:minutes|mins?|hours?|hrs?)\b/gi, ' ')
    // ISO dates and month-name dates
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, ' ')
    // relative days and weekday references
    .replace(/\b(?:tomorrow|today|tonight)\b/gi, ' ')
    .replace(/\b(?:next|this|coming)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|week|month)\b/gi, ' ')
    .replace(/\b(?:on\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, ' ')
    // leading booking verb + article, e.g. "book a", "I need to schedule the"
    .replace(/^\s*(?:please\s+)?(?:i\s+(?:need|want|would\s+like|'?d\s+like)\s+(?:to\s+)?)?(?:book|schedule|arrange|set\s+up|create|make)\s+(?:a\s+|an\s+|the\s+)?/i, '')
    // dangling prepositions left behind after the strips above
    .replace(/\s+\b(?:on|at|for|about|regarding|from|by)\b\s*/gi, ' ')
    .replace(/[.,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // A trailing preposition/conjunction can survive the pass above (e.g.
    // "project kickoff on at" -> "project kickoff at"). Strip once more at the end.
    .replace(/\s+\b(?:on|at|for|about|regarding|from|by|and|the|a|an)\s*$/i, '')
    .trim();

  // If stripping left a usable noun phrase, use it. Reject results that are too
  // short or that are just a leftover verb, so we ask a clarifying question instead.
  const looksLikeTitle =
    withoutNoise.length >= 3 &&
    !/^(?:book|schedule|arrange|set|create|make|something|anything)\b/i.test(withoutNoise);

  if (looksLikeTitle) {
    title = withoutNoise.charAt(0).toUpperCase() + withoutNoise.slice(1);
  }

  return { title, date, time, durationMinutes };
}

export const aiService = {
  /**
   * Runs one conversational turn:
   *   1. ask the LLM to extract structured intent (untrusted)
   *   2. validate + merge into the rolling draft
   *   3. decide deterministically what is still missing
   *   4. log the interaction for observability
   *
   * If the LLM is unavailable, we still return a usable reply and keep whatever
   * draft we already had — the chat degrades gracefully instead of erroring.
   */
  async runTurn(params: {
    sessionId: string;
    userId: string;
    draft: Partial<BookingDraft>;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    userMessage: string;
  }): Promise<TurnOutcome> {
    const started = Date.now();
    const referenceDate = new Date().toISOString().slice(0, 10);

    const messages = buildExtractionMessages({
      referenceDate,
      draft: params.draft,
      history: params.history,
      userMessage: params.userMessage,
    });

    // Provider-agnostic call: walks the configured provider chain (primary, then
    // any AI_FALLBACKS) and returns the first usable extraction.
    const result = await callLlm(messages, { json: true });
    const extracted = result.ok ? parseExtraction(result.content) : null;

    let outcome: TurnOutcome;
    let logOutcome: 'extracted' | 'clarify' | 'failed';

    if (extracted) {
      const draft = mergeDraft(params.draft, extracted);
      const missing = computeMissing(draft);
      outcome = {
        reply: extracted.reply || fallbackReply(missing),
        intent: extracted.intent,
        draft,
        missing,
        readyToBook: missing.length === 0,
        aiAvailable: true,
        provider: result.providerId,
        model: result.model,
      };
      logOutcome = missing.length === 0 ? 'extracted' : 'clarify';
    } else {
      // LLM unavailable — fall back to the deterministic extractor so the user
      // can still complete a booking, just with less flexible language handling.
      const heuristic = heuristicExtract(params.userMessage, referenceDate);
      const merged: Partial<BookingDraft> = {
        title: heuristic.title ?? params.draft.title ?? null,
        date: heuristic.date ?? params.draft.date ?? null,
        time: heuristic.time ?? params.draft.time ?? null,
        durationMinutes: heuristic.durationMinutes ?? params.draft.durationMinutes ?? 60,
        notes: params.draft.notes ?? null,
      };
      const draft: BookingDraft = { ...EMPTY_DRAFT, ...merged };
      const missing = computeMissing(draft);
      outcome = {
        reply: fallbackReply(missing),
        intent: missing.length === 0 ? 'book' : 'unknown',
        draft,
        missing,
        // The heuristic CAN complete a draft, so a booking is possible even
        // without the LLM — the UI just flags that replies are simplified.
        readyToBook: missing.length === 0,
        aiAvailable: false,
        provider: result.providerId,
        model: result.model,
        aiErrorReason: result.reason,
      };
      logOutcome = 'failed';
    }

    // Observability — never let a logging failure break the user's turn.
    chatRepository
      .logAiInteraction({
        sessionId: params.sessionId,
        userId: params.userId,
        provider: result.providerId,
        model: result.model,
        latencyMs: Date.now() - started,
        outcome: logOutcome,
        requestPayload: { userMessage: params.userMessage, draft: params.draft },
        responsePayload: extracted ? { ...extracted } : null,
        errorMessage: result.error ?? null,
      })
      .catch((err) => logger.warn('ai_log_write_failed', { error: String(err) }));

    return outcome;
  },

  /**
   * Reports which provider the app would use right now, without making a call.
   * Surfaced via GET /api/ai/status so operators can see configuration state
   * (and so the UI can explain a degraded assistant).
   */
  status() {
    return activeProviderInfo();
  },

  /** Converts a complete draft into concrete ISO timestamps. */
  draftToWindow(draft: BookingDraft): { startsAt: string; endsAt: string } | null {
    if (!draft.date || !draft.time) return null;
    const startsAt = new Date(`${draft.date}T${draft.time}:00.000Z`);
    if (Number.isNaN(startsAt.getTime())) return null;
    const minutes = draft.durationMinutes ?? 60;
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  },
};
