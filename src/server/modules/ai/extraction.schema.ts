import { z } from 'zod';

/**
 * Validation for whatever the LLM returns. This is the trust boundary: model
 * output is parsed defensively, and anything malformed degrades to a safe
 * "unknown" intent rather than throwing.
 */

export const INTENTS = ['book', 'reschedule', 'cancel', 'provide_info', 'smalltalk', 'unknown'] as const;

export const extractionResultSchema = z.object({
  intent: z.enum(INTENTS).catch('unknown'),
  title: z.string().trim().max(160).nullable().catch(null),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .nullable()
    .catch(null),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM')
    .nullable()
    .catch(null),
  durationMinutes: z.number().int().min(15).max(480).nullable().catch(null),
  notes: z.string().trim().max(2000).nullable().catch(null),
  reply: z.string().trim().min(1).max(1000).catch('Sorry, could you rephrase that?'),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/**
 * Extracts the first JSON object from a model response.
 * Handles the common failure mode where the model wraps JSON in prose or fences.
 */
export function parseExtraction(raw: string | null): ExtractionResult | null {
  if (!raw) return null;

  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;

  const candidate = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(candidate);
    const result = extractionResultSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
