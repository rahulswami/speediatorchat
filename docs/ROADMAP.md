# Speediator — Product Roadmap

Each phase follows the four-step discipline from CLAUDE.md: **Plan → Implement → Test → Manual test steps**. Do not begin a phase until the previous one is complete and manually verified.

---

## Phase 1 — Foundation

**Goal**: A working monorepo skeleton, multi-tenant data model, auth, and local dev environment. No WhatsApp yet.

**Deliverables**
- `pnpm` monorepo with `apps/web`, `apps/api`, `apps/worker`, `packages/prisma`, `packages/types`
- Docker Compose: PostgreSQL, Redis, MinIO
- Prisma schema: `organizations`, `users`, `organization_members` (role: `owner | admin | agent`)
- JWT-based auth: sign-up, log-in, refresh token, log-out (token blacklist via Redis)
- Invite-by-email flow: invite token → accept → join organization
- Organization provisioning: create org, slug, timezone, locale
- `organizationId` middleware/guard wiring — tenant scope enforced on every authenticated request
- Logger interceptor: redacts `accessToken`, `token`, `secret`, `password`
- Health-check endpoints (`/health/live`, `/health/ready`)
- Seed script for local dev (two orgs, two users each)
- Integration tests: tenant isolation on `organization_members` reads

**Key schema tables**
```
organizations        id, slug, name, timezone, locale, created_at
users                id, email, password_hash, name, avatar_url, created_at
organization_members id, organization_id, user_id, role, invited_by, joined_at
```

---

## Phase 2 — WhatsApp Connection

**Goal**: A business can connect a WhatsApp Business Account (WABA) and phone number. Webhooks are received and stored.

**Deliverables**
- `packages/whatsapp`: Cloud API client with versioned base URL, retry/backoff, Redis rate-limiting
- AES-256-GCM token encryption/decryption utility
- `whatsapp_accounts` table: stores encrypted token, WABA ID, phone number ID, display name, webhook verify token
- Meta webhook endpoint: signature verification guard → store raw payload → enqueue → `200 OK`
- `webhook_events` table: raw payload, status, retry count, idempotency key
- Worker consumer: dequeues, marks processing, logs result, handles duplicates via `wamid` idempotency key
- Dashboard page: "Connect WhatsApp" — Embedded Signup or manual token entry
- Settings page: show connected number, disconnect option (clears token, does not call Meta)
- Integration tests: signature verification rejects tampered payloads; duplicate `wamid` processed once

**Key schema tables**
```
whatsapp_accounts    id, organization_id, waba_id, phone_number_id, display_name,
                     encrypted_token, iv, auth_tag, verified, created_at
webhook_events       id, organization_id, whatsapp_account_id, meta_message_id,
                     payload (jsonb), status, retry_count, processed_at, created_at
```

---

## Phase 3 — Live Inbox

**Goal**: Agents can see inbound messages in real time and reply to customers.

**Deliverables**
- `conversations` and `messages` tables
- Socket.IO gateway: agents subscribe to their organization's room; new inbound messages emit `conversation.updated`
- Worker consumer: parses inbound `messages` webhook event → upsert contact → upsert conversation → insert message → emit socket event
- Inbox UI: conversation list (sorted by last activity), message thread, reply composer
- 24-hour session window indicator per conversation (green/amber/red badge)
- Message status updates: `sent`, `delivered`, `read` (from status webhook events)
- Supported inbound types: text, image, document, audio, video, location, sticker (display only for unsupported types)
- Media download: presign S3 URL for display; never proxy media bytes through the API
- Conversation assignment: assign to agent or unassigned pool
- Conversation status: `open | pending | resolved | snoozed`
- Integration tests: two orgs cannot see each other's conversations via WebSocket or REST

**Key schema tables**
```
contacts             id, organization_id, phone, name, avatar_url, opted_in,
                     opted_in_at, opted_out_at, opted_out, last_seen_at
conversations        id, organization_id, contact_id, whatsapp_account_id,
                     assigned_to (user_id), status, last_message_at,
                     session_expires_at, created_at
messages             id, conversation_id, organization_id, direction (in|out),
                     type, content (jsonb), meta_message_id, status,
                     sent_at, delivered_at, read_at, created_at
```

---

## Phase 4 — Contacts

**Goal**: Full contact management with import, segmentation, and opt-in/opt-out lifecycle.

**Deliverables**
- Contact list UI: search, filter by opt-in status, tag, last seen
- Contact detail page: timeline of messages, attributes, tags
- Custom attributes: key-value pairs per contact (e.g. `order_id`, `city`, `plan`)
- Tags: many-to-many, free-form, used for segmentation
- CSV import: map columns → preview → confirm → background BullMQ job → progress indicator
- CSV export: filtered contact list
- Opt-out keyword detection (in inbox consumer): `STOP`, `UNSUBSCRIBE`, `OPT OUT` → set `opted_out = true`
- Opt-in management: manual toggle with audit log, bulk opt-in via import
- Duplicate detection: merge contacts sharing the same phone number
- Integration tests: opted-out contacts blocked from outbound sends

**Key schema tables**
```
contact_tags         id, organization_id, name, color
contact_tag_map      contact_id, tag_id
contact_attributes   id, contact_id, organization_id, key, value, created_at
contact_imports      id, organization_id, filename, row_count, status, error_log, created_at
```

---

## Phase 5 — Templates

**Goal**: Teams can create, submit, sync, and manage WhatsApp message templates.

**Deliverables**
- Read current Meta template API docs before implementing (use `WebFetch`)
- Template builder UI: header (text/image/video/document), body with variable placeholders `{{1}}`, footer, buttons (CTA / quick reply)
- Template categories: `MARKETING`, `UTILITY`, `AUTHENTICATION`
- Submit to Meta via Cloud API; poll or webhook for approval status
- Sync templates from Meta on demand and on `message_template_status_update` webhook event
- Local `templates` table mirrors Meta state; status: `PENDING | APPROVED | REJECTED | PAUSED | DISABLED`
- Template preview with sample variable values
- Template duplication and version history (read-only past versions)
- Guard: only `APPROVED` templates may be selected for sending
- Integration tests: `REJECTED` template cannot be used in a campaign or manual send

**Key schema tables**
```
templates            id, organization_id, whatsapp_account_id, meta_template_id,
                     name, language, category, status, components (jsonb),
                     rejection_reason, created_at, synced_at
```

---

## Phase 6 — Campaigns

**Goal**: Broadcast template messages to a filtered audience with scheduling, throttling, and analytics.

**Deliverables**
- Read current Meta broadcast/send-message docs before implementing
- Campaign builder: name, WhatsApp account, template, variable mapping (static value or contact attribute), audience (all opted-in / by tag / by segment)
- Audience estimate before launch
- Schedule: send now or at a future datetime (stored in UTC, shown in org timezone)
- Campaign statuses: `draft | scheduled | running | paused | completed | failed`
- BullMQ campaign job: fans out per-contact send jobs; respects Meta rate limits via `packages/whatsapp` token bucket
- Per-contact send result recorded (success / failed / skipped-opted-out / skipped-no-session)
- Analytics page per campaign: sent, delivered, read, failed, reply rate — counts derived from `messages` table
- Pause and resume: pause drains in-flight jobs, resume re-enqueues remaining contacts
- Integration tests: opted-out contacts are never enqueued; tenant B cannot trigger tenant A's campaign

**Key schema tables**
```
campaigns            id, organization_id, whatsapp_account_id, template_id,
                     name, status, audience_filter (jsonb), variable_map (jsonb),
                     scheduled_at, started_at, completed_at, created_by
campaign_contacts    id, campaign_id, contact_id, status, error, sent_at
```

---

## Phase 7 — Automation and AI

**Goal**: Visual workflow builder for drip sequences, triggers, and AI-assisted reply suggestions.

**Deliverables**
- Workflow builder UI: trigger → condition nodes → action nodes (drag-and-drop canvas)
- Triggers: inbound keyword match, contact tag added, contact attribute change, campaign reply, webhook (external)
- Conditions: contact attribute comparisons, opt-in status, time-of-day, day-of-week
- Actions: send template, send free-form message (within session), assign conversation, add/remove tag, update attribute, wait (delay node), webhook call (outbound)
- Workflow versioning: publish vs. draft
- Execution log per contact: node-by-node trace for debugging
- AI reply suggestions: on new inbound message, call Claude API to suggest 3 replies in agent's language based on conversation history; shown as ghost buttons in inbox; one-click insert
- AI summary: summarise long conversation on demand
- Opt-out respected: any send action checks `opted_in` before executing
- Integration tests: workflow execution is idempotent; opted-out contact skips send actions

**Key schema tables**
```
workflows            id, organization_id, name, trigger_type, trigger_config (jsonb),
                     nodes (jsonb), edges (jsonb), status (draft|active|paused), version
workflow_executions  id, workflow_id, contact_id, conversation_id, status,
                     current_node_id, started_at, completed_at
workflow_exec_steps  id, execution_id, node_id, status, output (jsonb), executed_at
```

---

## Phase 8 — Billing

**Goal**: Usage-based and seat-based subscription billing gated through a paywall.

**Deliverables**
- Read current Razorpay (or Stripe) subscription docs before implementing
- Plans: `Starter`, `Growth`, `Scale` — differentiated by MAU (monthly active contacts), agents, campaigns/month
- Subscription lifecycle: create, upgrade, downgrade, cancel, renew
- Webhooks from payment provider → update org plan state
- Usage metering: track conversations initiated, templates sent, AI calls per billing period
- Hard limits enforced at send time (queue jobs check quota before processing)
- Soft limits: warning at 80% usage, email at 100%
- Billing portal page: current plan, usage meters, invoice history, upgrade CTA
- 14-day free trial on sign-up, no card required
- Integration tests: org at quota cannot enqueue additional campaign contacts

**Key schema tables**
```
subscriptions        id, organization_id, plan, status, provider_subscription_id,
                     current_period_start, current_period_end, cancelled_at
usage_records        id, organization_id, metric, period_start, period_end, value
```

---

## Phase 9 — Integrations and Public API

**Goal**: Native integrations for common Indian SMB tools and a public REST API for custom workflows.

**Deliverables**
- Public REST API: versioned at `/v1`, JWT or API-key auth, OpenAPI 3 spec auto-generated from NestJS decorators
- API keys: create, list, revoke; scoped permissions (read contacts, send messages, manage campaigns)
- Webhooks (outbound): teams subscribe to events (`message.received`, `conversation.resolved`, `campaign.completed`); signed with HMAC-SHA-256
- Native integrations:
  - **Shopify**: order placed → WhatsApp order confirmation; abandoned cart → follow-up template
  - **WooCommerce**: same event set via plugin + webhook
  - **Razorpay**: payment link generation from conversation
  - **Shiprocket / Delhivery**: shipment tracking updates via WhatsApp
  - **Zapier / Make (webhook-in)**: trigger workflows from external automation
- Integration marketplace UI: connect, disconnect, configure field mapping
- Integration tests: API key from org A cannot read org B's contacts

**Key schema tables**
```
api_keys             id, organization_id, name, key_hash, scopes (text[]),
                     last_used_at, expires_at, created_by
outbound_webhooks    id, organization_id, url, events (text[]), secret_hash, active
integrations         id, organization_id, type, config (jsonb encrypted), status, created_at
```

---

## Phase 10 — Production Hardening

**Goal**: The system is observable, resilient, and ready for public launch.

**Deliverables**
- **Observability**: structured JSON logs (Pino), metrics (Prometheus + Grafana), distributed tracing (OpenTelemetry → Jaeger or Tempo)
- **Alerting**: PagerDuty / Opsgenie rules for webhook queue depth, worker error rate, API error rate, DB connection pool exhaustion
- **Database**: read replica for reporting queries; connection pooling via PgBouncer
- **Redis**: Sentinel or Cluster for HA; separate Redis instances for cache vs. BullMQ
- **CDN / edge**: static assets and presigned media URLs behind CloudFront or Cloudflare
- **Rate limiting**: per-org and per-IP limits on public API and webhook endpoint (Redis sliding window)
- **Security audit**: OWASP Top 10 scan, dependency audit (`pnpm audit`), secrets scan (truffleHog)
- **Pen-test prep**: document threat model; verify tenant isolation, auth token handling, webhook signature
- **Runbooks**: deployment, rollback, DB migration, Redis failover, Meta webhook re-processing
- **Load test**: simulate 100 concurrent orgs, 10 k campaign sends/hour; confirm queue depth and latency SLOs
- **Disaster recovery**: daily DB snapshot, tested restore procedure, RTO < 4 h, RPO < 1 h
- **Status page**: public uptime page (Instatus or self-hosted)
- **GDPR / IT Act compliance notes**: data residency, right-to-erasure endpoint (`DELETE /v1/contacts/:id` hard-deletes PII)

---

## Milestone summary

| Phase | Theme | Gate to next phase |
|---|---|---|
| 1 | Foundation | Auth + tenant isolation tests green |
| 2 | WhatsApp Connection | Webhook received, stored, queued, idempotent |
| 3 | Live Inbox | Agent can reply; socket delivers in < 1 s |
| 4 | Contacts | Import 10 k contacts; opt-out respected |
| 5 | Templates | Template approved end-to-end in sandbox |
| 6 | Campaigns | 1 k-contact blast completes with analytics |
| 7 | Automation & AI | Workflow runs end-to-end; AI suggestion shown |
| 8 | Billing | Subscription created; quota hard-stops enforced |
| 9 | Integrations & API | Shopify order triggers WhatsApp message |
| 10 | Production Hardening | Load test passes; runbooks written |
