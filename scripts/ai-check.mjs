#!/usr/bin/env node
/**
 * AI provider diagnostics.
 *
 *   npm run ai:check                 # check the configured provider chain
 *   npm run ai:check -- groq         # check a specific provider
 *   npm run ai:check -- groq gemini  # check several
 *
 * Sends one real extraction request per provider so you learn immediately
 * whether a key works, whether the model name is valid, and whether the account
 * is rate-limited — instead of discovering it through a vague UI banner.
 *
 * Prints a clear PASS/FAIL per provider and never prints the key itself.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load .env without adding a dotenv dependency (same approach as migrate.mjs).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  const raw = await readFile(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // .env is optional when the platform injects env vars directly.
}

// ---------------------------------------------------------------------------
// Minimal provider table. Kept in sync with src/server/modules/ai/providers.ts
// by hand — this script is dependency-free so it can run before `npm install`.
// ---------------------------------------------------------------------------
const PROVIDERS = {
  mistral: {
    label: 'Mistral AI',
    family: 'openai-chat',
    baseUrl: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
    auth: 'bearer',
    envKeys: ['MISTRAL_API_KEY'],
    defaultModel: 'mistral-small-latest',
    json: true,
    docs: 'https://console.mistral.ai/',
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    family: 'openai-chat',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    auth: 'bearer',
    envKeys: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-4o-mini',
    json: true,
    docs: 'https://platform.openai.com/api-keys',
  },
  groq: {
    label: 'Groq',
    family: 'openai-chat',
    baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    auth: 'bearer',
    envKeys: ['GROQ_API_KEY'],
    defaultModel: 'openai/gpt-oss-120b',
    json: true,
    docs: 'https://console.groq.com/keys',
  },
  gemini: {
    label: 'Google Gemini',
    family: 'google-gemini',
    baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    auth: 'query',
    envKeys: ['GEMINI_API_KEY'],
    defaultModel: 'gemini-2.0-flash',
    json: true,
    docs: 'https://aistudio.google.com/app/apikey',
  },
  grok: {
    label: 'xAI Grok',
    family: 'openai-chat',
    baseUrl: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
    auth: 'bearer',
    envKeys: ['GROK_API_KEY', 'XAI_API_KEY'],
    defaultModel: 'grok-2-latest',
    json: true,
    docs: 'https://console.x.ai/',
  },
  nvidia: {
    label: 'NVIDIA NIM',
    family: 'openai-chat',
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    auth: 'bearer',
    envKeys: ['NVIDIA_API_KEY'],
    defaultModel: 'meta/llama-3.3-70b-instruct',
    json: true,
    docs: 'https://build.nvidia.com/',
  },
  openrouter: {
    label: 'OpenRouter',
    family: 'openai-chat',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    envKeys: ['OPENROUTER_API_KEY'],
    defaultModel: 'openai/gpt-4o-mini',
    json: true,
    docs: 'https://openrouter.ai/keys',
  },
  ollama: {
    label: 'Ollama (local)',
    family: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    auth: 'none',
    envKeys: ['OLLAMA_API_KEY'],
    defaultModel: 'llama3.1',
    json: false,
    docs: 'https://ollama.com/download',
  },
  custom: {
    label: 'Custom OpenAI-compatible endpoint',
    family: 'openai-chat',
    baseUrl: process.env.AI_BASE_URL || '',
    auth: 'bearer',
    envKeys: ['AI_API_KEY'],
    defaultModel: process.env.AI_CUSTOM_MODEL || 'gpt-4o-mini',
    json: true,
    docs: 'Set AI_BASE_URL + AI_API_KEY',
  },
};

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);

function resolveKey(p) {
  for (const k of p.envKeys) {
    // NOTE: an env var can exist but be empty (e.g. `GROQ_API_KEY=` or an
    // unset-but-exported var). Treat whitespace-only values as absent, otherwise
    // the diagnostics report "key present" and the app then fails with a 401.
    const value = (process.env[k] || '').trim();
    if (value) return { key: value, envKey: k };
  }
  return { key: null, envKey: p.envKeys[0] };
}

function resolveModel(p, id) {
  // Global AI_MODEL wins, then the provider-specific override, then the default.
  // Mirrors resolveModel() in src/server/modules/ai/providers.ts.
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  const perProvider = {
    mistral: process.env.MISTRAL_MODEL,
    openai: process.env.OPENAI_MODEL,
    groq: process.env.GROQ_MODEL,
    gemini: process.env.GEMINI_MODEL,
    grok: process.env.GROK_MODEL,
    nvidia: process.env.NVIDIA_MODEL,
    openrouter: process.env.OPENROUTER_MODEL,
    ollama: process.env.OLLAMA_MODEL,
    custom: process.env.AI_CUSTOM_MODEL,
  }[id];
  if (perProvider) return perProvider;
  return p.defaultModel;
}

const PROBE_MESSAGES = [
  {
    role: 'system',
    content:
      'You extract structured appointment data. Reply with JSON only: ' +
      '{"intent":"book","title":string|null,"date":string|null,"time":string|null,' +
      '"durationMinutes":number|null,"notes":string|null,"reply":string}',
  },
  {
    role: 'user',
    content: 'REFERENCE DATE (today, UTC): 2026-10-14\n\nUSER MESSAGE: Book a dental checkup next tuesday at 2pm for 45 minutes',
  },
];

async function probe(id) {
  const p = PROVIDERS[id];
  if (!p) {
    return { id, label: id, ok: false, reason: 'unknown provider id' };
  }

  const { key, envKey } = resolveKey(p);
  const model = resolveModel(p, id);
  const needsKey = p.auth !== 'none';

  if (needsKey && !key) {
    return { id, label: p.label, model, ok: false, reason: `${envKey} not set`, docs: p.docs };
  }
  if (p.family === 'openai-chat' && !p.baseUrl) {
    return { id, label: p.label, model, ok: false, reason: 'base URL not set (AI_BASE_URL)', docs: p.docs };
  }

  let url;
  let headers = { 'Content-Type': 'application/json' };
  let body;

  if (p.family === 'google-gemini') {
    url = `${p.baseUrl}/models/${model}:generateContent?key=${key}`;
    body = {
      contents: PROBE_MESSAGES.filter((m) => m.role !== 'system').map((m) => ({
        role: 'user',
        parts: [{ text: m.content }],
      })),
      systemInstruction: { parts: [{ text: PROBE_MESSAGES[0].content }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
        ...(p.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
  } else {
    url = `${p.baseUrl}/chat/completions`;
    if (key) headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      messages: PROBE_MESSAGES,
      temperature: 0.2,
      max_tokens: 400,
      ...(p.json ? { response_format: { type: 'json_object' } } : {}),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latency = Date.now() - started;
    const text = await res.text();

    if (!res.ok) {
      // Surface the vendor's own message — it is usually the most actionable
      // part ("Rate limit exceeded", "Invalid API key", "model not found").
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        detail = j?.error?.message || j?.message || JSON.stringify(j).slice(0, 300);
      } catch {
        /* keep raw text */
      }
      return { id, label: p.label, model, ok: false, status: res.status, latency, reason: detail, docs: p.docs };
    }

    let content = null;
    try {
      const j = JSON.parse(text);
      content =
        p.family === 'google-gemini'
          ? (j.candidates?.[0]?.content?.parts ?? []).map((x) => x.text || '').join('') || null
          : j.choices?.[0]?.message?.content ?? null;
    } catch {
      /* fall through to bad_response */
    }

    if (!content) {
      return { id, label: p.label, model, ok: false, latency, reason: 'no content in response', docs: p.docs };
    }

    // Verify the model actually honoured the JSON contract — that is the property
    // the app depends on, so a plain-text 200 is only a partial success.
    let parsed = null;
    try {
      const first = content.indexOf('{');
      const last = content.lastIndexOf('}');
      if (first !== -1 && last > first) parsed = JSON.parse(content.slice(first, last + 1));
    } catch {
      /* not JSON */
    }

    return {
      id,
      label: p.label,
      model,
      ok: true,
      latency,
      jsonOk: Boolean(parsed),
      sample: parsed,
      raw: parsed ? null : content.slice(0, 200),
      docs: p.docs,
    };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      id,
      label: p.label,
      model,
      ok: false,
      reason: aborted ? `timed out after ${TIMEOUT_MS}ms` : String(err.message || err),
      docs: p.docs,
    };
  }
}

async function main() {
  if (process.argv.includes('--list')) {
    console.log('\nRegistered providers:\n');
    for (const [id, p] of Object.entries(PROVIDERS)) {
      const { key, envKey } = resolveKey(p);
      const state = p.auth === 'none' ? 'no key needed' : key ? 'key present' : `${envKey} missing`;
      console.log(`  ${id.padEnd(12)} ${p.label.padEnd(34)} ${state}`);
    }
    console.log('\nSet AI_PROVIDER=<id> (and optionally AI_MODEL) to use one.\n');
    return;
  }

  const argIds = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  let ids = argIds;

  if (ids.length === 0) {
    const primary = (process.env.AI_PROVIDER || 'mistral').toLowerCase();
    const fallbacks = (process.env.AI_FALLBACKS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    ids = [primary, ...fallbacks];
  }

  console.log('\nAI provider diagnostics');
  console.log('='.repeat(60));
  console.log(`Chain: ${ids.join(' -> ')}`);
  console.log(
    `Keys detected: ${
      Object.values(PROVIDERS)
        .flatMap((p) => p.envKeys)
        .filter((k) => process.env[k])
        .join(', ') || '(none)'
    }`,
  );
  console.log('='.repeat(60));

  let anyOk = false;
  for (const id of ids) {
    const r = await probe(id);
    const tag = r.ok ? (r.jsonOk ? 'PASS' : 'WARN') : 'FAIL';
    console.log(`\n[${tag}] ${id} — ${r.label}`);
    console.log(`       model:   ${r.model}`);
    if (r.ok) {
      console.log(`       latency: ${r.latency}ms`);
      if (r.jsonOk) {
        console.log(`       json:    OK`);
        console.log(`       sample:  ${JSON.stringify(r.sample)}`);
        anyOk = true;
      } else {
        console.log(`       json:    NOT parseable (app falls back to heuristics)`);
        console.log(`       raw:     ${r.raw}`);
      }
    } else {
      if (r.status) console.log(`       status:  ${r.status}`);
      if (r.latency) console.log(`       latency: ${r.latency}ms`);
      console.log(`       reason:  ${r.reason}`);
      console.log(`       docs:    ${r.docs}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(anyOk ? 'Result: at least one provider is working.' : 'Result: no provider succeeded.');
  console.log(
    anyOk
      ? 'The app will use the first working provider in the chain.'
      : 'The app will run in deterministic-fallback mode (form + heuristics).',
  );
  console.log('='.repeat(60) + '\n');
  process.exit(anyOk ? 0 : 1);
}

main();
