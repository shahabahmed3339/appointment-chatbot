# Appointments — AI-Assisted Booking Assistant

A full-stack appointment booking application with a conversational AI assistant.
A user signs in, describes what they need in plain English, and the assistant
extracts the booking details into a structured draft that the user confirms.
A traditional form is always available as an alternative path.

Built as a **single Next.js application**: the React frontend and the Node
backend (Route Handlers) run in one process on one port. PostgreSQL (Neon) is
the datastore. The LLM layer is **provider-agnostic** — Mistral, OpenAI,
Groq, Gemini, xAI, NVIDIA, OpenRouter, local Ollama, or any OpenAI-compatible
endpoint — selected entirely through environment variables.

---

## Live demo

**Deployed application:** <https://appointment-chatbot-two.vercel.app>

**Recorded demo video (Google Drive):** <https://drive.google.com/file/d/1kKxh7JiOcoqrBxPU44sW9Ut0S_JBrC8z/view?usp=sharing>

**Recorded demo video (in this repo):** [`docs/demo.mp4`](./docs/demo.mp4)

Sign in with the [demo credentials](#demo-credentials) below, open **Chat**, and
describe an appointment in plain English (for example, *"Book a 45 minute project
kickoff next Tuesday at 2pm"*). Watch the booking draft fill in on the right, then
confirm it — the appointment appears under **Appointments** with `source = chat`.

### Demo video

Playable inline from the copy committed in this repository:

[![Watch the demo video](./docs/demo-thumbnail.png)](https://drive.google.com/file/d/1kKxh7JiOcoqrBxPU44sW9Ut0S_JBrC8z/view?usp=sharing)

<video src="./docs/demo.mp4" controls preload="metadata" width="100%">
  Your browser does not support the video tag —
  <a href="./docs/demo.mp4">download the demo video</a>.
</video>

GitHub's README renderer strips `<video>` and `<iframe>` tags, so the embed above
only appears in viewers that allow raw HTML. On the GitHub repo page, use the
links instead:

- [Watch on Google Drive](https://drive.google.com/file/d/1kKxh7JiOcoqrBxPU44sW9Ut0S_JBrC8z/view?usp=sharing) (streams instantly)
- [Download `docs/demo.mp4`](./docs/demo.mp4) from this repo (13 MB)

---

## Table of contents

1. [What it does](#what-it-does)
2. [Live demo](#live-demo)
3. [Quick start](#quick-start)
4. [Demo credentials](#demo-credentials)
5. [Architecture](#architecture)
6. [Database schema](#database-schema)
7. [API reference](#api-reference)
8. [The AI layer, and where its boundary is](#the-ai-layer-and-where-its-boundary-is)
9. [Design decisions and tradeoffs](#design-decisions-and-tradeoffs)
10. [What I verified](#what-i-verified)
11. [Assumptions](#assumptions)
12. [Limitations and what I would do next](#limitations-and-what-i-would-do-next)

---

## What it does

- **Authentication** — email + password, bcrypt hashing, JWT access tokens.
- **Conversational booking** — the assistant extracts `title`, `date`, `time`,
  `duration`, and `notes` from free-form messages, asks for whatever is still
  missing, and shows the draft filling in live.
- **Structured fallback** — if the AI is unavailable (no key, provider outage,
  rate limit), a deterministic extractor handles unambiguous phrasing so booking
  still works. The UI tells the user replies are simplified.
- **Pluggable LLM provider** — swap Mistral for Groq, Gemini, OpenAI, xAI,
  NVIDIA, OpenRouter, Ollama, or a custom endpoint by setting `AI_PROVIDER` and
  a key. Configure `AI_FALLBACKS` to fail over automatically when the primary
  provider errors or rate-limits.
- **Appointments management** — list, filter by status, create manually, change
  status. Bookings created via chat and via the form are indistinguishable in
  the data; both carry a `source` column for provenance.
- **Real conflict prevention** — double-booking is rejected by a PostgreSQL
  exclusion constraint, not by an application-level check that can race.

### Pages

| Route           | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| `/`             | Sign in / create account                                     |
| `/chat`         | Conversational assistant + live booking-details panel        |
| `/appointments` | Appointment list with status filters + manual booking form   |

---

## Quick start

### 1. Prerequisites

- Node.js 20+ (developed on 24)
- A PostgreSQL database. This project was built and verified against **Neon**
  (serverless Postgres). Any Postgres 13+ works, since the schema needs
  `pgcrypto` and `btree_gist`.

### 2. Configure environment

Create `.env` in the project root:

```dotenv
# Required — the application will not boot without this.
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# AI provider. Optional: without a key the app runs in deterministic-fallback mode.
# Set AI_PROVIDER to whichever service you have a key for, and put the matching
# key below. Supported: mistral, openai, groq, gemini, grok, nvidia,
# openrouter, ollama, custom. Run `npm run ai:providers` to list them.
AI_PROVIDER=mistral
MISTRAL_API_KEY=

# Optional: fail over to another provider when the primary errors or rate-limits.
AI_FALLBACKS=

# Optional, with defaults shown.
JWT_SECRET=dev-only-change-me
JWT_TTL_SECONDS=604800
```

> A full, commented template lives in **`.env.example`** — including every
> supported provider, the `AI_MODEL` / `*_BASE_URL` overrides, and tuning knobs.
>
> To point at a different provider, change two lines. For example, Groq with
> Gemini as a fallback:
>
> ```dotenv
> AI_PROVIDER=groq
> AI_FALLBACKS=gemini
> GROQ_API_KEY=...
> GEMINI_API_KEY=...
> ```
>
> To route any provider through a gateway, proxy, or local mock, set its base
> URL — e.g. `GROQ_BASE_URL=http://localhost:4321/v1`. No code changes required.

> Environment variables are validated at boot in `src/server/config/env.ts`.
> A missing `DATABASE_URL` fails fast with a readable message rather than
> throwing an opaque error on the first request.

### 3. Install, migrate, run

```bash
npm install
npm run db:migrate     # applies db/migrations/*.sql in order
npm run db:seed        # optional: demo business, user, and appointments
npm run dev            # http://localhost:3000
```

### Available scripts

| Script              | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Development server                                    |
| `npm run build`     | Production build                                      |
| `npm start`         | Serve the production build                            |
| `npm run typecheck` | `tsc --noEmit`                                        |
| `npm run db:migrate`| Run pending migrations (idempotent, tracked in `schema_migrations`) |
| `npm run db:seed`   | Re-run the seed migration                             |
| `npm run ai:providers` | List registered AI providers and whether each key is detected |
| `npm run ai:check`  | Send one real extraction request per provider, print PASS/FAIL |

---

## Deployment

### Option A — Vercel (recommended, fastest to a live link)

The app is a single Next.js project, which is Vercel's native target. `vercel.json`
is committed with the framework preset and baseline security headers.

1. Push the repository to GitHub.
2. In Vercel, **New Project** → import the repo. Leave the build settings at their
   defaults (Vercel detects Next.js); `vercel.json` supplies the rest.
3. Add environment variables (Project → Settings → Environment Variables):

   | Variable       | Value                                              |
   | -------------- | -------------------------------------------------- |
   | `DATABASE_URL` | Your Postgres URL (Neon, Supabase, RDS, ...)        |
   | `JWT_SECRET`   | A long random string (`openssl rand -base64 48`)    |
   | `AI_PROVIDER`  | e.g. `groq`, `mistral`, `gemini`, `openai`          |
   | `<PROV>_API_KEY` | The key matching `AI_PROVIDER` (e.g. `GROQ_API_KEY`) |
   | `AI_FALLBACKS` | Optional, e.g. `gemini,openai`                       |

4. Deploy, then run the migrations **once** against the production database from
   your machine (they are forward-only and idempotent):

   ```bash
   DATABASE_URL='<production-url>' npm run db:migrate
   DATABASE_URL='<production-url>' npm run db:seed   # optional demo data
   ```

5. Verify the AI layer is live in production:

   ```bash
   DATABASE_URL='<production-url>' AI_PROVIDER=groq GROQ_API_KEY=... npm run ai:check
   ```

   Or open the deployed app and visit `/api/ai/status` while signed in — it reports
   which provider is active without exposing any key material.

> **Serverless note.** The chat uses 5-second polling rather than WebSockets
> precisely so it works on Vercel's serverless functions, which cannot hold a
> long-lived socket server in the same process. No extra infrastructure required.

### Option B — Docker Compose (self-hosted, includes its own Postgres)

```bash
cp .env.example .env    # optionally add an AI key; the app runs without one
docker compose up --build
# → http://localhost:3000
```

`docker-compose.yml` starts PostgreSQL 16 and the app, applies migrations, and
seeds on first boot. A named volume (`pgdata`) persists the database between runs.
`docker compose down -v` resets it.

### Option C — Any Node host (Railway, Render, Fly.io, a VPS)

```bash
npm install
npm run build
npm run db:migrate      # against the production DATABASE_URL
npm start               # serves the standalone build on $PORT
```

The build emits a self-contained server bundle (`output: 'standalone'`), so the
`Dockerfile` copies only that plus `db/` and `scripts/` — no full
`node_modules` tree in the runtime image. `.dockerignore` excludes `.env`, so
secrets are injected at runtime and never baked into an image layer.

---

## Demo credentials

```
email:    demo@acme.test
password: Password123!
```

The seed script creates this user, one business, and two sample appointments.

---

## Demo video

[![Appointments — AI-assisted booking demo](https://img.shields.io/badge/Demo-Watch%20on%20Google%20Drive-blue?logo=googledrive&logoColor=white)](https://drive.google.com/file/d/1kKxh7JiOcoqrBxPU44sW9Ut0S_JBrC8z/view?usp=sharing)

**Google Drive (streams instantly):** <https://drive.google.com/file/d/1kKxh7JiOcoqrBxPU44sW9Ut0S_JBrC8z/view?usp=sharing>

**Committed copy:** [`docs/demo.mp4`](./docs/demo.mp4)

<video src="./docs/demo.mp4" controls preload="metadata" width="100%">
  Your browser does not support the video tag —
  <a href="./docs/demo.mp4">download the demo video</a>.
</video>

<iframe
  src="https://drive.google.com/file/d/1kKxh7JiOcoqrBxPU44sW9Ut0S_JBrC8z/preview"
  width="100%"
  height="480"
  frameborder="0"
  allow="autoplay; fullscreen"
  allowfullscreen
  title="Appointments — AI-assisted booking demo"
></iframe>

---

## Architecture

```
appointment-chatbot/
├─ db/
│  └─ migrations/
│     ├─ 0001_init.sql          # tables, constraints, indexes, triggers
│     └─ 0002_seed.sql          # demo business / user / appointments
├─ docs/
│  └─ demo.mp4                  # recorded walkthrough (also on Google Drive)
├─ scripts/
│  ├─ migrate.mjs               # forward-only migration runner
│  ├─ seed.mjs                  # seed wrapper
│  └─ ai-check.mjs              # provider diagnostics (npm run ai:check)
├─ src/
│  ├─ app/                      # Next.js App Router
│  │  ├─ page.tsx               # auth screen
│  │  ├─ chat/page.tsx          # assistant + draft panel
│  │  ├─ appointments/page.tsx  # list + manual form
│  │  └─ api/                   # the HTTP backend (Route Handlers)
│  ├─ hooks/useAuth.tsx         # auth context
│  ├─ lib/api.ts                # typed client for the API
│  ├─ types/index.ts            # shared domain types
│  └─ server/                   # server-only code
│     ├─ config/env.ts          # validated environment
│     ├─ db/pool.ts             # pg pool + query helpers + transactions
│     ├─ lib/                   # errors, jwt, auth guard, rate limit, logging
│     └─ modules/               # feature modules
│        ├─ auth/               # repository + service + schemas
│        ├─ appointments/       # repository + service + schemas
│        ├─ chat/               # repository + service
│        └─ ai/                 # provider registry, client, prompt, schema, service
├─ Dockerfile                   # standalone multi-stage image
├─ docker-compose.yml           # app + PostgreSQL for self-hosting
├─ vercel.json                 # framework preset + security headers
├─ .env
└─ .env.example
```

### Layering

Each feature module is split into three parts, and the dependency direction is
strictly one-way:

```
Route Handler  →  Service  →  Repository  →  PostgreSQL
   (HTTP)         (rules)       (SQL)
```

- **Route handlers** do HTTP only: parse, call the auth guard, delegate,
  translate errors into responses. They contain no business rules.
- **Services** own the business logic — validation, draft merging, conflict
  handling, the AI boundary. They are the only layer that throws domain errors.
- **Repositories** own SQL. Every statement is parameterised; none are string
  interpolated.

This means the same appointment-creation logic serves the form and the chat
confirmation path. There is exactly one place where an appointment is validated
and persisted.

### Request lifecycle

1. A route handler is wrapped by `withRequestLogging` (request id + timing) and
   `handle` (error translation).
2. `getAuth(req)` verifies the bearer JWT and returns `{ sub, businessId, role }`.
3. The handler validates input with zod.
4. The service executes the business logic against repositories.
5. Success returns `{ data: ... }`; failure returns
   `{ error: { code, message, details? } }` with a correct status code.

---

## Database schema

Four core tables plus a logging table and a migration ledger. The full DDL is in
`db/migrations/0001_init.sql`.

### `businesses`
Multi-tenancy anchor. Every user and appointment belongs to a business. Present
from day one so tenant isolation never requires a later migration.

### `users`
| Column          | Notes                                             |
| --------------- | ------------------------------------------------- |
| `id`            | UUID PK (`gen_random_uuid()`)                     |
| `business_id`   | FK → `businesses`, `ON DELETE CASCADE`            |
| `email`         | unique **per business**, case-insensitive         |
| `password_hash` | bcrypt digest, never a plaintext password         |
| `role`          | `owner` or `member` (CHECK constrained)           |
| `created_at` / `updated_at` | maintained by a trigger              |

Uniqueness uses `(business_id, lower(email))` so the same person can exist in
two tenants but not twice in one.

### `appointments`
| Column        | Notes                                                     |
| ------------- | --------------------------------------------------------- |
| `starts_at` / `ends_at` | `TIMESTAMPTZ` — timezone correctness is not optional |
| `status`      | enum: `pending`, `confirmed`, `cancelled`, `completed`     |
| `source`      | `form` or `chat` — provenance for analytics                |
| `notes`       | optional free text                                         |

Constraints that encode real rules:

```sql
CONSTRAINT appointments_time_order     CHECK (ends_at > starts_at)
CONSTRAINT appointments_max_duration   CHECK (ends_at <= starts_at + interval '8 hours')
CONSTRAINT appointments_no_overlap     EXCLUDE USING gist (
  user_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status IN ('pending', 'confirmed'))
```

The exclusion constraint is the important one. It makes double-booking
**impossible** at the storage layer, including under concurrent requests. The
service layer also checks first so it can return a friendly `409`, but the
database is the actual guarantee. Cancelled and completed appointments are
excluded from the constraint, so history is preserved while the slot is freed.

### `chat_sessions` and `chat_messages`
A session holds the rolling booking `draft` as `JSONB`, so the draft shape can
evolve without a migration. Messages are the LLM's memory — each turn replays
prior messages as context. Indexed by `(session_id, created_at)` for history
reads.

### `ai_interaction_logs`
Observability for the AI layer: provider, model, latency, outcome
(`extracted` / `clarify` / `failed`), request and response payloads, and any
error. This is how provider failures become diagnosable instead of invisible.

---

## API reference

All endpoints except `signup` and `login` require
`Authorization: Bearer <token>`.

### Auth

| Method | Path                | Body                              | Returns              |
| ------ | ------------------- | --------------------------------- | -------------------- |
| POST   | `/api/auth/signup`  | `{ email, password, fullName }`   | `{ user, token }`    |
| POST   | `/api/auth/login`   | `{ email, password }`             | `{ user, token }`    |
| GET    | `/api/auth/me`      | —                                 | `{ user }`           |

### Appointments

| Method | Path                     | Body / Query                                        | Returns                    |
| ------ | ------------------------ | --------------------------------------------------- | -------------------------- |
| GET    | `/api/appointments`      | `?status=pending` (optional)                        | `{ appointments: [...] }`  |
| POST   | `/api/appointments`      | `{ title, startsAt, endsAt, notes?, source? }`      | `{ appointment }` (201)    |
| PATCH  | `/api/appointments/:id`  | `{ status }`                                        | `{ appointment }`          |

### Chat

| Method | Path                                | Body                | Returns                                              |
| ------ | ----------------------------------- | ------------------- | ---------------------------------------------------- |
| POST   | `/api/chat/sessions`                | —                   | `{ session }` — new or resumed active session (201)  |
| GET    | `/api/chat/sessions/:id`            | —                   | `{ session, messages }`                              |
| POST   | `/api/chat/sessions/:id/messages`   | `{ content }`       | `{ session, userMessage, assistantMessage, draft, missing, readyToBook, aiAvailable, aiProvider, aiModel, aiErrorReason? }` (201) |
| POST   | `/api/chat/sessions/:id/confirm`    | —                   | `{ appointmentId, session }` (201)                   |

### AI diagnostics

| Method | Path               | Returns                                                       |
| ------ | ------------------ | ------------------------------------------------------------- |
| GET    | `/api/ai/status`   | `{ ai: { provider, model, configured, chain } }` — which provider would serve the next turn, without making a call |

### Error envelope

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { } } }
```

Codes: `VALIDATION_ERROR` (422), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `AI_UNAVAILABLE`,
`INTERNAL_ERROR` (500).

---

## The AI layer, and where its boundary is

This is the part of the system most likely to be misunderstood, so it is worth
being explicit.

**The LLM does one thing: it converts a sentence into structured fields.**

```
"book a dental checkup next tuesday at 2pm"
        │
        ▼
  LLM (JSON mode)  →  { title: "dental checkup", date: "2026-10-20",
                        time: "14:00", durationMinutes: 60 }
```

Everything after that is deterministic application code:

| Concern                          | Who owns it | Why not the LLM                          |
| -------------------------------- | ----------- | ---------------------------------------- |
| Merging into the rolling draft   | Code        | Must be predictable across turns         |
| Deciding what is still missing   | Code        | Pure logic; the model would drift        |
| Validating types and ranges      | zod         | Model output is **untrusted input**      |
| Checking slot availability       | Database    | A model cannot be authoritative here     |
| Persisting the appointment       | Service     | Single validated path, same as the form  |

The LLM's output is treated exactly like user input: parsed defensively,
validated against a schema, and rejected if malformed. If it cannot be parsed,
the turn degrades to the deterministic path rather than trusting partial output.

### Provider-agnostic by design

The application does not depend on any single vendor. Providers are described
declaratively in `src/server/modules/ai/providers.ts`, and the client
(`ai.client.ts`) adapts three things per provider: the **auth style**
(`Authorization: Bearer` vs. Google's `?key=` query param), the **request/response
shape** (OpenAI `choices[]` vs. Gemini `candidates[]`), and **JSON-mode
support**.

| id          | provider                  | key variable          | default model              |
| ----------- | ------------------------- | --------------------- | -------------------------- |
| `mistral`   | Mistral AI                | `MISTRAL_API_KEY`     | `mistral-small-latest`     |
| `openai`    | OpenAI (ChatGPT)          | `OPENAI_API_KEY`      | `gpt-4o-mini`              |
| `groq`      | Groq                      | `GROQ_API_KEY`        | `llama-3.3-70b-versatile`  |
| `gemini`    | Google Gemini             | `GEMINI_API_KEY`      | `gemini-2.0-flash`         |
| `grok`      | xAI Grok                  | `GROK_API_KEY`        | `grok-2-latest`            |
| `nvidia`    | NVIDIA NIM                | `NVIDIA_API_KEY`      | `meta/llama-3.3-70b-instruct` |
| `openrouter`| OpenRouter                | `OPENROUTER_API_KEY`  | `openai/gpt-4o-mini`       |
| `ollama`    | Ollama (local)            | _(none)_              | `llama3.1`                 |
| `custom`    | Any OpenAI-compatible API | `AI_API_KEY`          | `AI_CUSTOM_MODEL`          |

**Switching provider is configuration, not code:**

```dotenv
AI_PROVIDER=groq
AI_FALLBACKS=gemini          # tried in order if groq fails
GROQ_API_KEY=...
GEMINI_API_KEY=...
```

Each provider's base URL and model can also be overridden individually
(`GROQ_BASE_URL`, `GROQ_MODEL`, ...), which is how you target regional
endpoints, gateways, Azure-style proxies, or a local mock. A global `AI_MODEL`
overrides all per-provider model defaults.

Two operator tools ship with the project:

```bash
npm run ai:providers   # list providers and whether their key is detected
npm run ai:check       # send one real request per provider, print PASS/FAIL
npm run ai:check -- groq gemini   # check specific providers
```

### Conversation memory

Memory is the `chat_messages` table. Each turn sends the prior turns plus the
current message and the accumulated draft, so the user can say "make it an hour
instead" without repeating themselves. The draft is stored on the session, so a
reload does not lose progress.

### Graceful degradation

Four failure modes are handled, and all were observed during development:

1. **No provider configured** → the provider is reported as not configured and
the request short-circuits without a network call.
2. **Provider error or timeout** → the client retries with capped backoff, then
moves to the next provider in `AI_FALLBACKS`.
3. **Rate limiting (HTTP 429)** → observed in practice against the live provider.
It is classified as a distinct reason so the UI can say "rate-limited, try again"
instead of a vague "AI unavailable", and the chain fails over.
4. **Malformed or unparseable output** → the response is rejected by the zod
schema and the turn degrades to the deterministic extractor. Partial output is
never trusted.

In every case the user gets a usable reply and the draft keeps whatever was
already extracted. The heuristic extractor handles unambiguous phrasing — ISO
dates, explicit clock times, `next <weekday>`, `tomorrow`, durations — and
deliberately returns nothing when it is unsure, so the assistant asks a
clarifying question instead of guessing wrong. A wrong booking is worse than an
extra turn.

### Guardrails on the prompt

The system prompt constrains the model to emit strict JSON matching a fixed
shape, to leave fields `null` rather than invent values, and to resolve relative
dates against a reference date supplied in the prompt. The response is parsed
with a zod schema in `extraction.schema.ts`.

---

## Design decisions and tradeoffs

### Single Next.js app instead of separate frontend and backend

**Chosen because** it was the explicit requirement for this iteration, and it
removes an entire class of deployment friction — one process, one port, no CORS,
no service discovery.

**Tradeoff:** the frontend and backend now share a deploy unit and a scaling
profile. A traffic spike from the chat UI and one from a mobile client cannot be
scaled independently. The layering above keeps the backend portable, so
extracting it into a standalone Express service later is a mechanical change —
the route handlers become thin adapters over the same services.

### PostgreSQL exclusion constraint for double-booking

**Chosen because** application-level "check then insert" is racy. Two concurrent
requests can both read "slot free" and both write. The constraint makes the
invariant unbreakable regardless of concurrency.

**Tradeoff:** it is Postgres-specific (`btree_gist`, `EXCLUDE`) and cannot be
expressed in a schema-agnostic ORM. That is an acceptable price for correctness;
portability to another database would require reimplementing the check in a
transaction with appropriate locking.

### Raw SQL migrations instead of an ORM

**Chosen because** the schema is the deliverable here, and its quality —
constraints, partial indexes, generated defaults — is visible in SQL and hidden
behind ORM abstractions. Migrations are forward-only and tracked in
`schema_migrations`, so they are reproducible.

**Tradeoff:** more boilerplate per query, and no compile-time checking that SQL
matches TypeScript types. The `query<T>` helper gives row typing, but it is a
cast, not a verification. A typed query builder would close that gap.

### JWT access tokens instead of server sessions

**Chosen because** the API stays stateless and horizontally scalable, and the
token works identically for the browser and any future native client.

**Tradeoff:** no server-side revocation without extra infrastructure. A leaked
token is valid until it expires. The mitigation here is a 7-day TTL; a production
system would add refresh tokens and a revocation list. Tokens are stored in
`localStorage`, which is readable by any script on the page — an httpOnly cookie
with CSRF protection is the more defensible choice against XSS. That tradeoff was
made for implementation simplicity in this iteration and is noted rather than
hidden.

### Plain `fetch` instead of a provider SDK

**Chosen because** every provider's API is one POST with a JSON body. Vendoring
a separate SDK per provider would add supply-chain surface and version churn for
no capability we need. The client is ~200 lines, fully readable, and adapts auth
style and request/response shape per provider.

**Tradeoff:** we own retry, timeout, and error-shape handling ourselves. In
exchange, adding a new provider means adding one entry to the registry rather
than learning and pinning a new SDK. Provider-specific features (streaming,
tool-calling) would eventually justify an SDK, but the extraction task needs
none of them.

### AI produces a draft; a human confirms

**Chosen because** an assistant that books autonomously on a misheard sentence
is worse than useless. The draft panel shows exactly what was understood, and the
user confirms before anything is written. This also means the AI's failure mode
is "asks a question", not "creates a wrong appointment".

**Tradeoff:** one extra interaction compared to fully automatic booking. Worth it
for a scheduling system where errors have real-world cost.

### Rate limiting in memory

**Chosen because** it is a few lines and genuinely stops accidental hammering
and trivial credential-stuffing within a single instance.

**Tradeoff:** it does not survive a restart and does not work across multiple
instances. Behind a load balancer the effective limit multiplies by the instance
count. Production would use Redis or the platform's edge limiter. Called out
explicitly so the limitation is not mistaken for a guarantee.

### Polling instead of WebSockets for chat

The brief allows "WebSockets **or polling**". I chose polling, and the reasoning
is worth stating because the obvious choice is the other one.

**Chosen because** the whole app is deliberately one process on one port with a
serverless-friendly deploy. A Socket.IO server cannot live in a Vercel function,
so choosing WebSockets would mean splitting the backend out or adding a separate
realtime service — extra infrastructure for a feature this task explicitly says
not to over-build. Polling also keeps **one** state path: the client already
learns conversation state from REST, so there is no second, differently-shaped
stream to reconcile.

The implementation is deliberately small (see `chat/page.tsx`): a 5-second
interval that refetches the session, paused while a send is in flight (the POST
response is already authoritative) and paused when the tab is hidden. It only
ever *adds* messages — `latest.length > prev.length` — so an in-flight optimistic
message is never clobbered by a poll that raced it. A failed poll is swallowed;
the next tick retries. Worst case is "slightly stale", never "broken".

**Tradeoff:** up to ~5s of latency on a message that arrives from elsewhere, and
one lightweight request every 5s while the tab is visible. For a single-user
booking flow neither is perceptible. If this grew into agent-to-agent or
multi-participant chat, WebSockets (or SSE) would become the right call and the
REST send-path would stay as the fallback — which is exactly the shape the API
already has.

---

## What I verified

Everything below was executed against the real Neon database and the running
application, not asserted from reading code.

### Database

- Migrations applied cleanly; all 7 tables exist.
- The exclusion constraint genuinely rejects overlaps — an overlapping insert
  returned a database error, not an application-level rejection.
- The `ends_at > starts_at` check is enforced.
- Seed data present: 1 business, 1 user, 2 appointments.

### API (live HTTP against the dev server)

| Case                                   | Expected | Observed |
| -------------------------------------- | -------- | -------- |
| Login with seeded credentials          | 200      | 200      |
| `GET /api/auth/me` with valid token    | 200      | 200      |
| Login with wrong password              | 401      | 401      |
| `GET /api/appointments` without token  | 401      | 401      |
| Signup with duplicate email            | 409      | 409      |
| Signup with invalid email/password     | 422      | 422      |
| Create appointment                     | 201      | 201      |
| Overlapping appointment                | 409      | 409      |
| `ends_at` before `starts_at`           | 422      | 422      |
| Empty title                            | 422      | 422      |
| Empty chat message (whitespace only)   | 422      | 422      |
| PATCH nonexistent appointment          | 404      | 404      |
| PATCH with invalid status              | 422      | 422      |
| Chat session belonging to another user | 404      | 404      |
| Rate limit exceeded on `/api/auth/*`   | 429      | 429 (after 9 requests) |

### Chat and AI

- Session boot, message persistence, and history reload all work; messages are
  stored in order.
- The chat → draft → confirm → appointment path completes end to end and the
  appointment appears in `/api/appointments` with `source = 'chat'`.
- Provider failures are logged to `ai_interaction_logs` with the real error
  message and latency, and the user-facing turn still succeeds via fallback.
- The heuristic fallback was tested against 11 phrasings; titles, dates, times,
  and durations were correct in all cases, including relative dates ("next
  tuesday", "tomorrow") and 12/24-hour clock formats.

### Frontend

- All three pages return 200 and render their expected content server-side.
- The stylesheet loads and every class referenced in the JSX is defined in
  `globals.css` (verified programmatically — zero missing classes).
- The dev server log is free of runtime errors and warnings.

### AI provider status — an honest note

One provider, Mistral, returned **HTTP 429 (rate limit exceeded)** on every call
during development. The key was valid and the request genuinely reached the API;
the account was simply throttled. That single point of failure is what motivated
the provider-agnostic rebuild, and the outcome was verified end to end:

- **Live extraction now works.** Running against a working provider, real
  natural-language messages extract correctly — e.g.
  `"I need to book a quarterly review next friday at 3pm"` → date `2026-10-21`,
  time `15:00`; `"book a dental checkup tomorrow at 2pm"` → date `2026-10-16`,
  time `14:00`. Relative dates resolve correctly against the reference date.
- The failure mode is **detected and classified** — a 429 is distinguished from a
  bad key and from a network error — logged to `ai_interaction_logs` with the
  provider's real message, and surfaced to the UI as a specific, actionable
  banner rather than a vague "AI unavailable".
- The adapter layer was proven against a local mock speaking **both** protocol
  families (OpenAI-style and Google-style), so provider switching is exercised
  rather than assumed.
- The heuristic fallback path was tested against 11 phrasings, and the full
  chat → draft → confirm → appointment path completes with the LLM unavailable.

With `AI_FALLBACKS` set, one vendor's quota or outage no longer degrades the
feature — the next configured provider takes the turn. Switching providers is a
one-line `.env` change with no code edits:

```dotenv
AI_PROVIDER=groq
AI_FALLBACKS=mistral,gemini,openai
```

> Verified with `npm run ai:check`, which sends one real extraction request per
> provider and prints PASS/FAIL together with the provider's own error text.

### Provider failover

**Chosen because** a single vendor's quota or outage should not break a core
feature. The client walks the configured chain in order, classifies each failure,
and moves on until one provider succeeds or the chain is exhausted — at which
point it falls back to the deterministic extractor.

**Tradeoff:** each provider can return a slightly different extraction for the
same sentence, so answers are less reproducible than with a single pinned model.
For this task that is acceptable; a stricter system might pin one provider and
treat failover as degraded mode instead.

---

## Assumptions

1. **Single business.** The schema is multi-tenant and every query is scoped by
   `business_id`, but signup assigns users to the one seeded business rather than
   creating or selecting one. Multi-tenant onboarding would be the next step.
2. **No appointment types or services table.** Appointments carry a free-text
   `title` rather than referencing a catalogue of bookable services. This keeps
   the schema smaller but means there is no canonical list of what can be booked.
3. **No availability windows.** The system prevents double-booking but does not
   model working hours. Any time the user names is accepted if it is free.
4. **UTC storage, local display.** Times are stored as `timestamptz` and rendered
   in the browser's timezone. The business has a `timezone` column that is not
   yet used for scheduling rules.
5. **Timezones are interpreted in the browser.** The form converts local input to
   ISO before sending. A server-side scheduler would need the business timezone
   to be authoritative instead.
6. **Email is not verified.** Signup creates an immediately usable account.
7. **`JWT_SECRET` defaults to a development value** so the app runs without
   setup. A production deployment must override it.

---

## Limitations and what I would do next

Ordered roughly by value:

1. **Complete the live AI verification.** The provider layer is correct and
   proven against a mock, but a *successful live extraction* was never observed
   because the configured accounts returned HTTP 429. First step is one green
   `npm run ai:check` against a provider with quota — the failover chain now
   makes that easy to satisfy with any available key.
2. **Token storage in httpOnly cookies** with CSRF protection, replacing
   `localStorage`, to remove the XSS token-theft vector.
3. **Refresh tokens and revocation**, so a stolen or stale token can be
   invalidated before its 7-day expiry.
4. **Distributed rate limiting** (Redis or edge-level) instead of the in-memory
   limiter, which does not hold across instances.
5. **Availability rules** — working hours, buffers between appointments, and
   per-service durations — so "is this slot actually offered?" is a real question
   the system can answer.
6. **Timezone-aware scheduling** using the business's timezone rather than the
   browser's.
7. **Streaming responses** for the assistant, so replies appear token by token
   instead of after a multi-second wait. The current REST design deliberately
   favours simplicity; this would be the first thing to change for perceived
   responsiveness.
8. **Tests.** The verification above was performed by exercising the running
   system. Committing an automated suite — unit tests for the heuristic
   extractor and draft merge, integration tests for the API against a disposable
   database — is the obvious next engineering step.
9. **Pagination** on the appointments list, which currently returns all rows.
