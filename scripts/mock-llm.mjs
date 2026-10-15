#!/usr/bin/env node
/**
 * Mock LLM server — protocol-conformance harness for the provider adapter layer.
 *
 *   node scripts/mock-llm.mjs        # listens on :4321
 *
 * It speaks BOTH protocol families the client supports, so you can verify that
 * `ai.client.ts` builds the correct request shape and parses the correct
 * response shape without spending real provider quota:
 *
 *   OpenAI family   POST /v1/chat/completions
 *                   Authorization: Bearer test-custom-key
 *                   body: { model, messages[], temperature, response_format }
 *
 *   Gemini family   POST /v1beta/models/<model>:generateContent?key=test-gemini-key
 *                   body: { contents[], systemInstruction, generationConfig }
 *
 * Point any provider at it with a base-URL override:
 *
 *   GROQ_BASE_URL=http://localhost:4321/v1 GROQ_API_KEY=test-custom-key \
 *     npm run ai:check -- groq
 *
 *   GEMINI_BASE_URL=http://localhost:4321/v1beta GEMINI_API_KEY=test-gemini-key \
 *     npm run ai:check -- gemini
 *
 * It also honours an artificial failure mode via `MOCK_FAIL=429|500|timeout`,
 * which is how the retry and failover paths were exercised.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4321);

const EXTRACT = {
  intent: 'book',
  title: 'Dental checkup',
  date: '2026-10-20',
  time: '14:00',
  durationMinutes: 45,
  notes: null,
  reply: 'Got it — a dental checkup on Tuesday at 2pm for 45 minutes. Shall I book it?',
};

const OPENAI_KEY = process.env.MOCK_OPENAI_KEY || 'test-custom-key';
const GEMINI_KEY = process.env.MOCK_GEMINI_KEY || 'test-gemini-key';

/** Optional fault injection, so retry/failover paths can be tested deliberately. */
function injectedFailure(res) {
  const mode = (process.env.MOCK_FAIL || '').trim();
  if (!mode) return false;
  if (mode === 'timeout') return 'timeout'; // caller should just not respond
  const status = Number(mode);
  if (Number.isFinite(status) && status >= 400) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `injected failure ${status}` } }));
    return true;
  }
  return false;
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://localhost');
    const json = (o) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(o));
    };

    const failure = injectedFailure(res);
    if (failure === 'timeout') {
      console.log(`[timeout] ${req.method} ${url.pathname} — holding the connection open`);
      return; // never respond; the client's own timeout fires
    }
    if (failure) {
      console.log(`[fail] ${req.method} ${url.pathname} — injected ${process.env.MOCK_FAIL}`);
      return;
    }

    // --- Gemini family -------------------------------------------------------
    if (url.pathname.includes(':generateContent')) {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* fall through to shape check below */
      }
      const okShape =
        Array.isArray(parsed.contents) &&
        Boolean(parsed.systemInstruction?.parts?.[0]?.text) &&
        typeof parsed.generationConfig?.responseMimeType === 'string';
      const authOk = url.searchParams.get('key') === GEMINI_KEY;
      console.log(`[gemini] payload-shape-ok=${okShape} auth-ok=${authOk}`);
      if (!authOk) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad key' } }));
        return;
      }
      json({ candidates: [{ content: { parts: [{ text: JSON.stringify(EXTRACT) }] } }] });
      return;
    }

    // --- OpenAI family -------------------------------------------------------
    if (url.pathname.endsWith('/chat/completions')) {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* fall through to shape check below */
      }
      const auth = req.headers.authorization || '';
      const okShape =
        Array.isArray(parsed.messages) &&
        typeof parsed.model === 'string' &&
        typeof parsed.temperature === 'number' &&
        parsed.response_format?.type === 'json_object';
      console.log(
        `[openai] payload-shape-ok=${okShape} model=${parsed.model} auth=${auth.slice(0, 20)}`,
      );
      if (auth !== `Bearer ${OPENAI_KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad key' } }));
        return;
      }
      json({ choices: [{ message: { content: JSON.stringify(EXTRACT) } }] });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });
}).listen(PORT, () => {
  console.log(`mock LLM listening on http://localhost:${PORT}`);
  if (process.env.MOCK_FAIL) console.log(`fault injection active: MOCK_FAIL=${process.env.MOCK_FAIL}`);
});
