# Speediator — CLAUDE.md

Speediator is a multi-tenant WhatsApp marketing and support SaaS targeting Indian D2C brands and service businesses (clinics, coaching, salons, real-estate, edtech). It is a BSP-independent platform built on Meta's Cloud API, similar in category to AiSensy and Interakt but with original branding, UI, and product decisions.

---

## Repository layout

```
speediator/
├── apps/
│   ├── web/          # Next.js 14 + TypeScript + Tailwind — dashboard, inbox, campaign builder
│   ├── api/          # NestJS — REST + WebSocket gateway, business logic
│   └── worker/       # NestJS — BullMQ consumers, no HTTP surface
├── packages/
│   ├── prisma/       # Shared Prisma schema and generated client
│   ├── types/        # Shared TypeScript interfaces and Zod schemas
│   └── whatsapp/     # WhatsApp Cloud API client (single module, see §WhatsApp rules)
├── docs/             # Architecture decisions, roadmap, runbooks
├── docker-compose.yml
└── CLAUDE.md
```

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| API | NestJS, TypeScript, Fastify adapter |
| Worker | NestJS, BullMQ (Redis-backed) |
| ORM | Prisma 5 |
| Primary DB | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| Realtime inbox | Socket.IO (api process) |
| Media storage | S3-compatible (MinIO in dev, AWS S3 / Cloudflare R2 in prod) |
| Local dev | Docker Compose |

---

## Non-negotiable permanent rules

These rules apply to every phase, every PR, every file. Do not compromise them for speed.

### 1. Multi-tenancy — data isolation

- Every tenant-owned table **must** have an `organization_id UUID NOT NULL` column with a foreign key to `organizations`.
- Every Prisma query that touches a tenant-owned table **must** include `where: { organizationId }` derived from the authenticated session — never from a user-supplied query param.
- Write at least one integration test per resource that proves tenant B cannot read, write, or delete tenant A's data. These tests must pass before a resource is merged.
- Use a Prisma middleware or service base class to enforce the `organizationId` scope so it cannot be accidentally omitted.

### 2. WhatsApp credential security

- WhatsApp access tokens are encrypted at rest using AES-256-GCM. The encryption key lives in an environment variable (`WHATSAPP_TOKEN_ENCRYPTION_KEY`), never in the database or source.
- Tokens are decrypted only inside `packages/whatsapp` immediately before an outbound API call; decrypted values are never assigned to a variable that outlives the call scope.
- **Never log tokens.** Add a logger interceptor that redacts fields named `accessToken`, `token`, `secret`, and `password` from all log output.
- Tokens are **never sent to the browser**. API responses for channel settings return `{ configured: true }` rather than the token value.

### 3. Meta webhook security

- Every inbound webhook request **must** have its `X-Hub-Signature-256` header verified against the raw body bytes using the app secret before any parsing occurs.
- Reject (respond `403`) any request that is missing the header or fails verification.
- Implement this as a NestJS guard applied globally to the webhook controller, not inline.

### 4. Webhook processing — store-first, async

- The webhook controller stores the raw JSON payload in a `webhook_events` table and returns `200 OK` within the request handler — no business logic runs synchronously.
- A BullMQ consumer processes the stored event. Processing is idempotent: use Meta's `messages[].id` (e.g. `wamid.xxx`) as the idempotency key; skip with a `WARN` log if already processed.
- The `webhook_events` table tracks `status` (`pending | processing | processed | failed`) and `retry_count`.

### 5. WhatsApp API client — single module

- All calls to the Meta Cloud API go through `packages/whatsapp`. No other package imports `axios`, `fetch`, or any HTTP client to call Meta directly.
- The client reads the API version from config (`WHATSAPP_API_VERSION`, default `v20.0`). Bumping a version requires only a config change.
- The client implements exponential backoff with jitter (initial 1 s, max 32 s, up to 5 retries) and respects `Retry-After` headers.
- Rate limiting: the client queues requests per `phoneNumberId` to honour Meta's per-WABA limits. Use a token-bucket implementation backed by Redis so it works across multiple API instances.

### 6. Messaging compliance

- **24-hour session window**: track last inbound message timestamp per contact. Before sending a free-form message, check whether the window is still open. If closed, only approved templates may be sent.
- **Templates**: only send templates that have status `APPROVED` in the local database (synced from Meta). Never send a `PENDING` or `REJECTED` template.
- **Opt-in**: contacts must have `opted_in = true` before any outbound marketing message. The opt-in source and timestamp must be recorded.
- **Opt-out**: recognise opt-out keywords (`STOP`, `UNSUBSCRIBE`, `OPT OUT` — case-insensitive) and immediately set `opted_in = false` and `opted_out_at`. Do not send further marketing messages to opted-out contacts.
- These rules apply in both manual sends and automated campaign/workflow runs.

### 7. Meta API — always read official docs first

Before implementing any feature that touches the Meta Cloud API (new message type, template category, interactive component, webhook field, etc.), fetch the current official documentation. Do not rely on training-data memory. Meta deprecates and changes APIs frequently. Use the `WebFetch` tool to read docs.whatsapp.com.

### 8. Phase discipline

Work exactly one phase at a time:
1. **Plan** — outline what will be built, data models, API contracts, key decisions.
2. **Implement** — write the code.
3. **Test** — unit + integration tests pass; no skipped tests.
4. **Manual test steps** — provide a numbered list of curl commands, UI steps, or Postman calls that verify the phase end-to-end.

Do not start the next phase until the current phase clears all four steps.

---

## Development workflow

### Local setup

```bash
cp .env.example .env          # fill in secrets
docker compose up -d          # postgres, redis, minio
pnpm install
pnpm prisma migrate dev
pnpm dev                      # starts web, api, worker concurrently
```

### Environment variables (never commit real values)

```
DATABASE_URL=
REDIS_URL=
WHATSAPP_TOKEN_ENCRYPTION_KEY=   # 32-byte hex, never rotate without migrating tokens
WHATSAPP_APP_SECRET=             # for webhook signature verification
WHATSAPP_API_VERSION=v20.0
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
JWT_SECRET=
```

### Running tests

```bash
pnpm test              # unit tests (jest)
pnpm test:e2e          # integration tests (jest + real postgres + redis via Docker)
```

Integration tests use a dedicated test schema, reset between runs. Never run integration tests against a shared or production database.

### Migrations

- Always write a migration for schema changes: `pnpm prisma migrate dev --name <slug>`.
- Never edit an already-applied migration file.
- Include a rollback strategy note in the PR description for destructive migrations.

---

## Code conventions

- **TypeScript strict mode** everywhere. No `any` without a `// eslint-disable` comment explaining why.
- **Zod** for all external input validation (webhook payloads, API request bodies, env vars). Validated types propagate inward; raw `unknown` never passes a service boundary.
- **NestJS modules** are feature-scoped (e.g. `InboxModule`, `CampaignModule`). Cross-module communication goes through the module's exported service, not direct repository injection.
- **Error handling**: NestJS exception filters map domain errors to HTTP status codes. Worker consumers catch errors, record them on the job, and let BullMQ retry with backoff.
- **No `console.log`** in application code. Use the NestJS `Logger` or a scoped `PinoLogger`.
- **Comments**: only when the *why* is non-obvious — a hidden constraint, a Meta quirk, a compliance rule. No narration of what the code does.
- **Tests**: co-located `*.spec.ts` for units; `test/` directory for integration. Test names describe behaviour, not implementation.

---

## Security checklist (apply on every PR)

- [ ] No secrets in source or logs
- [ ] New tenant-owned tables have `organization_id` and a tenant-isolation test
- [ ] Input validated with Zod at the controller boundary
- [ ] SQL via Prisma only — no raw query string interpolation
- [ ] New webhook paths have signature verification
- [ ] Compliance rules applied to any new send path

---

## References

- Meta Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Meta Webhooks: https://developers.facebook.com/docs/graph-api/webhooks
- WhatsApp Business Policy: https://www.whatsapp.com/legal/business-policy
- See `docs/ROADMAP.md` for phased delivery plan
