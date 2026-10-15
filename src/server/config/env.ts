import { z } from 'zod';

/**
 * Centralised, validated environment configuration.
 *
 * Why validate at boot: a missing DATABASE_URL or JWT_SECRET should crash the
 * process immediately with a readable message, not surface as a 500 on the
 * first request. Everything else in the app imports `env` and can trust it.
 *
 * AI configuration is intentionally provider-agnostic: the app does not care
 * whether the key belongs to Mistral, OpenAI, Groq, Gemini, xAI, NVIDIA or a
 * local Ollama instance. The caller names a provider and the registry in
 * `src/server/modules/ai/providers.ts` knows how to talk to it.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

  // --- AI provider selection -------------------------------------------------
  // Primary provider, plus an optional ordered fallback chain. Both accept any
  // provider id registered in providers.ts (mistral, openai, groq, gemini,
  // grok, nvidia, openrouter, ollama, custom).
  AI_PROVIDER: z.string().default('mistral'),
  AI_MODEL: z.string().optional(),
  AI_FALLBACKS: z.string().optional(),

  // --- Provider credentials --------------------------------------------------
  // All optional: only the provider you actually select needs a key. Naming them
  // individually (rather than one AI_API_KEY) makes switching providers a
  // one-line change with no key shuffling.
  MISTRAL_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROK_API_KEY: z.string().optional(), // xAI
  XAI_API_KEY: z.string().optional(), // alias for GROK_API_KEY
  NVIDIA_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OLLAMA_API_KEY: z.string().optional(), // usually unnecessary for local Ollama

  // --- Per-provider base URL overrides ---------------------------------------
  // Optional. Useful for regional endpoints, gateways/proxies, Azure-style
  // deployments, and for pointing a provider at a local mock.
  MISTRAL_BASE_URL: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  GROQ_BASE_URL: z.string().optional(),
  GEMINI_BASE_URL: z.string().optional(),
  GROK_BASE_URL: z.string().optional(),
  NVIDIA_BASE_URL: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),

  // --- Generic OpenAI-compatible escape hatch --------------------------------
  // Point these at any OpenAI-compatible endpoint (vLLM, Together, DeepSeek,
  // Fireworks, LM Studio, a proxy, ...) and select AI_PROVIDER=custom.
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_CUSTOM_MODEL: z.string().optional(),

  // --- Tuning ----------------------------------------------------------------
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(700),
  AI_DEBUG: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Legacy / back-compat (the original Mistral-only names). Still honoured.
  MISTRAL_MODEL: z.string().optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function loadEnv() {
  const parsed = schema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    // Dev fallback only — production must supply a real secret.
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me',

    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_FALLBACKS: process.env.AI_FALLBACKS,

    MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GROK_API_KEY: process.env.GROK_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,

    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_CUSTOM_MODEL: process.env.AI_CUSTOM_MODEL,

    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    AI_MAX_RETRIES: process.env.AI_MAX_RETRIES,
    AI_TEMPERATURE: process.env.AI_TEMPERATURE,
    AI_MAX_TOKENS: process.env.AI_MAX_TOKENS,
    AI_DEBUG: process.env.AI_DEBUG,

    MISTRAL_BASE_URL: process.env.MISTRAL_BASE_URL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    GROQ_BASE_URL: process.env.GROQ_BASE_URL,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    GROK_BASE_URL: process.env.GROK_BASE_URL,
    NVIDIA_BASE_URL: process.env.NVIDIA_BASE_URL,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,

    MISTRAL_MODEL: process.env.MISTRAL_MODEL,

    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

/** Ordered list of provider ids to try: primary first, then fallbacks. */
export function providerChain(): string[] {
  const chain = [env.AI_PROVIDER];
  if (env.AI_FALLBACKS) {
    for (const raw of env.AI_FALLBACKS.split(',')) {
      const id = raw.trim().toLowerCase();
      if (id && !chain.includes(id)) chain.push(id);
    }
  }
  return chain;
}
