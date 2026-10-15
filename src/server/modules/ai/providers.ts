import { env } from '@/server/config/env';

/**
 * Provider registry.
 *
 * Every supported LLM is described declaratively here, so the rest of the app
 * never branches on "which vendor is this". Adding a provider means adding one
 * entry — no changes to the client, the service, the prompt, or the UI.
 *
 * Two protocol families cover essentially the whole market:
 *
 *   1. `openai-chat`      — POST <baseUrl>/chat/completions with
 *                           `{ model, messages, temperature, max_tokens }`.
 *                           Used by OpenAI, Mistral, Groq, xAI, NVIDIA NIM,
 *                           OpenRouter, Ollama's /v1 shim, and dozens of others.
 *
 *   2. `google-gemini`    — POST <baseUrl>/models/<model>:generateContent with
 *                           `contents[].parts[].text` and an API key in the
 *                           query string. Gemini is the one major outlier.
 *
 * Anything not covered by these two can be wired in via the `custom` provider
 * (OpenAI-compatible base URL) or by adding a family implementation below.
 */

export type ProviderFamily = 'openai-chat' | 'google-gemini';
export type AuthStyle = 'bearer' | 'x-api-key' | 'query' | 'none';

export interface ProviderConfig {
  /** Stable id used in AI_PROVIDER / AI_FALLBACKS. */
  id: string;
  /** Human label, surfaced in diagnostics and the UI banner. */
  label: string;
  family: ProviderFamily;
  /**
   * Default base URL without a trailing slash. Overridable per provider via
   * <PROVIDER>_BASE_URL (e.g. MISTRAL_BASE_URL, GEMINI_BASE_URL). That matters
   * for regional/sovereign endpoints, Azure-style proxies, gateways, and for
   * pointing a provider at a local mock in tests.
   */
  baseUrl: string;
  /** Auth mechanism for this vendor. */
  auth: AuthStyle;
  /** Env var that holds the credential, if any. */
  envKey?: string;
  /** Default model when AI_MODEL is not set. */
  defaultModel: string;
  /**
   * Whether the vendor supports OpenAI's strict `response_format: json_object`.
   * When false we still ask for JSON in the prompt and parse defensively — the
   * model just isn't *forced* into JSON mode by the API.
   */
  supportsJsonMode: boolean;
  /** Docs link, shown by the diagnostics script. */
  docs: string;
  /** Optional API key env var fallbacks (aliases). */
  envKeyAliases?: string[];
  /** Optional env var that overrides `baseUrl`. */
  baseUrlEnvKey?: string;
  /** Optional default for `baseUrlEnvKey`. */
  defaultBaseUrlEnvKey?: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    family: 'openai-chat',
    baseUrl: env.MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1',
    auth: 'bearer',
    envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-small-latest',
    supportsJsonMode: true,
    docs: 'https://console.mistral.ai/',
    baseUrlEnvKey: 'MISTRAL_BASE_URL',
  },

  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    family: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    auth: 'bearer',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    supportsJsonMode: true,
    docs: 'https://platform.openai.com/api-keys',
    baseUrlEnvKey: 'OPENAI_BASE_URL',
  },

  groq: {
    id: 'groq',
    label: 'Groq',
    family: 'openai-chat',
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: 'bearer',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    supportsJsonMode: true,
    docs: 'https://console.groq.com/keys',
    baseUrlEnvKey: 'GROQ_BASE_URL',
  },

  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    family: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    auth: 'query', // ?key=...
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    supportsJsonMode: true, // responseMimeType: application/json
    docs: 'https://aistudio.google.com/app/apikey',
    baseUrlEnvKey: 'GEMINI_BASE_URL',
  },

  grok: {
    id: 'grok',
    label: 'xAI Grok',
    family: 'openai-chat',
    baseUrl: 'https://api.x.ai/v1',
    auth: 'bearer',
    envKey: 'GROK_API_KEY',
    envKeyAliases: ['XAI_API_KEY'],
    defaultModel: 'grok-2-latest',
    supportsJsonMode: true,
    docs: 'https://console.x.ai/',
    baseUrlEnvKey: 'GROK_BASE_URL',
  },

  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    family: 'openai-chat',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    auth: 'bearer',
    envKey: 'NVIDIA_API_KEY',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    supportsJsonMode: true,
    docs: 'https://build.nvidia.com/',
    baseUrlEnvKey: 'NVIDIA_BASE_URL',
  },

  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    family: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    envKey: 'OPENROUTER_API_KEY',
    // OpenRouter routes to many vendors; this is a cheap, tool-friendly default.
    defaultModel: 'openai/gpt-4o-mini',
    supportsJsonMode: true,
    docs: 'https://openrouter.ai/keys',
    baseUrlEnvKey: 'OPENROUTER_BASE_URL',
  },

  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    family: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    auth: 'none',
    envKey: 'OLLAMA_API_KEY',
    defaultModel: 'llama3.1',
    supportsJsonMode: false,
    docs: 'https://ollama.com/download',
    baseUrlEnvKey: 'OLLAMA_BASE_URL',
  },

  /**
   * Escape hatch for ANY OpenAI-compatible endpoint. Set AI_BASE_URL +
   * AI_API_KEY + AI_CUSTOM_MODEL and AI_PROVIDER=custom. This covers vLLM,
   * Together, DeepSeek, Fireworks, LM Studio, Azure OpenAI proxies, and any
   * provider we haven't enumerated.
   */
  custom: {
    id: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    family: 'openai-chat',
    baseUrl: env.AI_BASE_URL ?? '',
    auth: 'bearer',
    envKey: 'AI_API_KEY',
    defaultModel: env.AI_CUSTOM_MODEL ?? 'gpt-4o-mini',
    supportsJsonMode: true,
    docs: 'Set AI_BASE_URL and AI_API_KEY.',
  },
};

/** Resolves the effective model for a provider: explicit AI_MODEL wins. */
export function resolveModel(provider: ProviderConfig): string {
  if (env.AI_MODEL) return env.AI_MODEL;
  // Back-compat: MISTRAL_MODEL still applies to the mistral provider.
  if (provider.id === 'mistral' && env.MISTRAL_MODEL) return env.MISTRAL_MODEL;
  return provider.defaultModel;
}

/** Reads the credential for a provider, following aliases. Returns null if absent. */
export function resolveApiKey(provider: ProviderConfig): string | null {
  const keys = [provider.envKey, ...(provider.envKeyAliases ?? [])].filter(
    (k): k is string => Boolean(k),
  );
  for (const key of keys) {
    const value = (env as unknown as Record<string, string | undefined>)[key];
    // An env var can exist but be empty. Treat blank as absent so a misconfigured
    // provider is skipped by the chain instead of failing mid-request with a 401.
    if (value && value.trim()) return value.trim();
  }
  return null;
}

export interface ResolvedProvider extends ProviderConfig {
  model: string;
  apiKey: string | null;
  /** False when the provider needs a key and none is configured. */
  configured: boolean;
}

/** Fully resolves a provider id into everything the client needs to make a call. */
export function resolveProvider(id: string): ResolvedProvider | null {
  const provider = PROVIDERS[id.toLowerCase()];
  if (!provider) return null;
  const apiKey = resolveApiKey(provider);
  const needsKey = provider.auth !== 'none';
  // A per-provider base URL override wins over the registry default. This is
  // how you point any provider at a gateway, an Azure-style proxy, or a mock.
  const override = provider.baseUrlEnvKey
    ? ((env as unknown as Record<string, string | undefined>)[provider.baseUrlEnvKey] ?? '')
    : '';
  const baseUrl = (override || provider.baseUrl).replace(/\/+$/, '');

  return {
    ...provider,
    baseUrl,
    model: resolveModel(provider),
    apiKey,
    configured: (!needsKey || Boolean(apiKey)) && Boolean(baseUrl),
  };
}

/** Lists registered provider ids — used by the diagnostics script. */
export function listProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}
