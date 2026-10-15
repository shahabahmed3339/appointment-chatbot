import { env, providerChain } from '@/server/config/env';
import { logger } from '@/server/lib/logger';
import { resolveProvider, ResolvedProvider } from './providers';

/**
 * Provider-agnostic LLM client.
 *
 * Design goals:
 *  - Callers pass a neutral message array; they never see vendor payload shapes.
 *  - Adding a provider is a registry entry, not a branch in this file.
 *  - Failure is explicit and typed: `reason` tells the caller WHY it failed, so
 *    the UI can say "rate limited, retry in a minute" instead of a vague
 *    "AI unavailable". That distinction was a real gap found in testing.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type FailureReason =
  | 'not_configured'
  | 'rate_limited'
  | 'unauthorized'
  | 'timeout'
  | 'bad_response'
  | 'provider_error'
  | 'network_error'
  | 'unknown';

export interface LlmCallResult {
  ok: boolean;
  content: string | null;
  latencyMs: number;
  /** Which provider actually served (or failed) this attempt. */
  providerId: string;
  providerLabel: string;
  model: string;
  reason?: FailureReason;
  error?: string;
  /** HTTP status, when the failure came from a response. */
  status?: number;
  attempts?: number;
}

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the vendor for strict JSON output where supported. */
  json?: boolean;
}

/** Maps an HTTP status onto our typed failure reasons. */
function classifyStatus(status: number): FailureReason {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'provider_error';
  if (status >= 400) return 'bad_response';
  return 'unknown';
}

/** How long to wait before retrying, honouring Retry-After when present. */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      // Cap so a hostile/incorrect header can't stall a request thread for minutes.
      return Math.min(seconds * 1000, 5000);
    }
  }
  return 400 * 2 ** attempt; // 400ms, 800ms, 1600ms ...
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Builds the request for the OpenAI chat-completions family. Shared by OpenAI,
 * Mistral, Groq, xAI, NVIDIA, OpenRouter, Ollama, and anything OpenAI-shaped.
 */
function buildOpenAiRequest(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  opts: CallOptions,
): { url: string; headers: Record<string, string>; body: unknown } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.auth === 'bearer' && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  } else if (provider.auth === 'x-api-key' && provider.apiKey) {
    headers['x-api-key'] = provider.apiKey;
  }

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature: opts.temperature ?? env.AI_TEMPERATURE,
    max_tokens: opts.maxTokens ?? env.AI_MAX_TOKENS,
  };

  if (opts.json && provider.supportsJsonMode) {
    body.response_format = { type: 'json_object' };
  }

  return { url: `${provider.baseUrl}/chat/completions`, headers, body };
}

/** Builds the request for Google Gemini, which uses a different payload shape. */
function buildGeminiRequest(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  opts: CallOptions,
): { url: string; headers: Record<string, string>; body: unknown } {
  // Gemini has no "system" role in `contents`; system text goes in systemInstruction.
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content }));
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? env.AI_TEMPERATURE,
      maxOutputTokens: opts.maxTokens ?? env.AI_MAX_TOKENS,
      ...(opts.json && provider.supportsJsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (systemParts.length > 0) {
    body.systemInstruction = { parts: systemParts };
  }

  const url = `${provider.baseUrl}/models/${provider.model}:generateContent?key=${provider.apiKey ?? ''}`;
  return { url, headers: { 'Content-Type': 'application/json' }, body };
}

/** Extracts the assistant text from either vendor's response envelope. */
function extractContent(family: string, json: unknown): string | null {
  if (family === 'google-gemini') {
    const g = json as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const parts = g.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    return text || null;
  }
  const o = json as { choices?: Array<{ message?: { content?: string } }> };
  return o.choices?.[0]?.message?.content ?? null;
}

/** Performs a single attempt against one provider. Never throws. */
async function callOnce(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  opts: CallOptions,
): Promise<LlmCallResult> {
  const started = Date.now();
  const base: Pick<LlmCallResult, 'providerId' | 'providerLabel' | 'model'> = {
    providerId: provider.id,
    providerLabel: provider.label,
    model: provider.model,
  };

  if (!provider.configured) {
    return {
      ok: false,
      content: null,
      latencyMs: 0,
      ...base,
      reason: 'not_configured',
      error: `${provider.envKey ?? 'API key'} is not set for provider "${provider.id}"`,
    };
  }

  const built =
    provider.family === 'google-gemini'
      ? buildGeminiRequest(provider, messages, opts)
      : buildOpenAiRequest(provider, messages, opts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);

  try {
    const res = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        content: null,
        latencyMs: Date.now() - started,
        ...base,
        reason: classifyStatus(res.status),
        status: res.status,
        error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
    }

    const json = await res.json();
    const content = extractContent(provider.family, json);
    if (!content) {
      return {
        ok: false,
        content: null,
        latencyMs: Date.now() - started,
        ...base,
        reason: 'bad_response',
        error: 'Provider returned 200 but no message content',
      };
    }
    return { ok: true, content, latencyMs: Date.now() - started, ...base };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      content: null,
      latencyMs: Date.now() - started,
      ...base,
      reason: aborted ? 'timeout' : 'network_error',
      error: aborted
        ? `Request timed out after ${env.AI_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
}

/**
 * Calls ONE provider with retry/backoff.
 *
 * Retry policy matters: a 429 is retried (with a short, capped delay) because a
 * per-minute quota genuinely can clear, but a 401 is not, because a bad key will
 * never fix itself. Earlier versions retried everything, which burned quota and
 * kept the account pinned at its limit.
 */
async function callProviderWithRetry(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  opts: CallOptions,
): Promise<LlmCallResult> {
  const maxRetries = env.AI_MAX_RETRIES;
  let last: LlmCallResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = await callOnce(provider, messages, opts);
    result.attempts = attempt + 1;

    if (result.ok) return result;
    last = result;

    const retryable =
      result.reason === 'rate_limited' ||
      result.reason === 'timeout' ||
      result.reason === 'provider_error' ||
      result.reason === 'network_error';

    if (!retryable || attempt === maxRetries) break;

    const delay = backoffMs(attempt, null);
    logger.warn('ai_retry', {
      provider: provider.id,
      attempt: attempt + 1,
      reason: result.reason,
      delayMs: delay,
    });
    if (delay > 0) await sleep(delay);
  }

  return last!;
}

export interface ChainResult extends LlmCallResult {
  /** Providers that were tried, in order. */
  tried: string[];
}

/**
 * Calls the configured provider, then each fallback in order, until one
 * succeeds. This is the single entry point used by the AI service, and it is
 * what makes a single vendor's rate limit a non-event.
 */
export async function callLlm(
  messages: ChatMessage[],
  opts: CallOptions = {},
): Promise<ChainResult> {
  const started = Date.now();
  const ids = providerChain();
  const tried: string[] = [];
  let last: LlmCallResult | null = null;

  for (const id of ids) {
    const provider = resolveProvider(id);
    if (!provider) {
      logger.warn('ai_unknown_provider', { provider: id });
      continue;
    }
    tried.push(id);

    const result = await callProviderWithRetry(provider, messages, opts);
    if (result.ok) {
      return { ...result, latencyMs: Date.now() - started, tried };
    }

    last = result;
    logger.warn('ai_provider_failed', {
      provider: id,
      reason: result.reason,
      status: result.status,
      error: result.error,
    });

    // A missing key on one provider is expected when a fallback is the real
    // target — keep walking. Anything else is worth a fallback too.
    continue;
  }

  if (last) return { ...last, latencyMs: Date.now() - started, tried };

  return {
    ok: false,
    content: null,
    latencyMs: Date.now() - started,
    providerId: ids[0] ?? 'none',
    providerLabel: 'none',
    model: 'none',
    reason: 'not_configured',
    error: 'No AI provider is configured. Set <PROVIDER>_API_KEY and AI_PROVIDER.',
    tried,
  };
}

/** Reports whether any provider in the chain is usable, and which one. */
export function activeProviderInfo(): {
  providerId: string;
  label: string;
  model: string;
  configured: boolean;
  chain: Array<{ id: string; label: string; configured: boolean; model: string }>;
} {
  const ids = providerChain();
  const chain = ids.map((id) => {
    const p = resolveProvider(id);
    return {
      id,
      label: p?.label ?? `unknown (${id})`,
      configured: p?.configured ?? false,
      model: p?.model ?? 'n/a',
    };
  });
  const firstUsable = chain.find((c) => c.configured);
  return {
    providerId: firstUsable?.id ?? ids[0] ?? 'none',
    label: firstUsable?.label ?? 'none configured',
    model: firstUsable?.model ?? 'n/a',
    configured: Boolean(firstUsable),
    chain,
  };
}
