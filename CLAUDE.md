# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot-reload, loads .env)
npm run dev

# Build TypeScript to build/
npm run build

# Run tests
npm test

# Lint
npm run lint

# Run production build
node build/index.js

# Smoke tests (require running server + DB)
./smoke-test-v1.sh [base_url]   # public endpoints only
./smoke-test.sh [base_url]      # full auth flow (test cases in smoke-tests/*.sh)
```

## Environment

Requires a `.env` file with:
```
CONNECTION_STRING=mysql://user:password@host:port/schema
JWT_SECRET=<min-32-characters>
JWT_ACCESS_TOKEN_TTL=900            # required, seconds (15min recommended)
JWT_REFRESH_TOKEN_TTL=2592000       # required, seconds (30 days recommended)
ACTIVATION_KEY_TTL=86400         # required, seconds (see ../CLAUDE.md → Verification Key TTLs)
RESET_KEY_TTL=3600               # required, seconds (see ../CLAUDE.md → Verification Key TTLs)
SMTP_HOST=smtp.protonmail.ch
SMTP_PORT=587
SMTP_LOGIN=notifier@mellonis.ru
SMTP_PASSWORD=<password>
SMTP_FROM_NAME=Система оповещений        # required, display name for From header
SMTP_FROM_ADDRESS=notifier@mellonis.ru   # required, email address for From header (no fallback to SMTP_LOGIN — would leak credentials)
ALLOWED_ORIGINS=https://poetry.mellonis.ru,https://old2.poetry.mellonis.ru  # required, comma-separated whitelist of client origins (CORS + email links)
WEBAUTHN_RP_ID=poetry.mellonis.ru       # optional, WebAuthn Relying Party ID (default: poetry.mellonis.ru, use "localhost" for local dev)
ADMIN_NOTIFY_EMAIL=admin@mellonis.ru  # optional, receives notifications on votes, registrations, account deletions, comment reports
MEILI_URL=http://poetry-meilisearch:7700  # optional, Meilisearch host (default: http://poetry-meilisearch:7700)
MEILI_MASTER_KEY=<key>               # optional (required for search to work), shared with Meilisearch container
```

See `.env.example` for a template. The server listens on `0.0.0.0:3000` (port overridable via `PORT` env var). `CONNECTION_STRING`, `JWT_SECRET`, and `ALLOWED_ORIGINS` are validated on startup. SMTP vars are required only in production (`NODE_ENV=production`); in dev mode, notifications are logged to the console instead. If `MEILI_MASTER_KEY` is not set, search is disabled (sync calls become no-ops, `GET /search` returns 503).

## Architecture

**CORS** is handled by `@fastify/cors`, registered in `src/index.ts` with origins from the `ALLOWED_ORIGINS` env var. Allows `GET`, `POST`, `PUT`, `PATCH`, `DELETE` methods and `Content-Type` + `Authorization` headers.

Fastify app using a plugin-based structure under `src/plugins/`:

- **`database/`** — registers the MySQL connection pool on the Fastify instance via `@fastify/mysql`
- **`auth/`** — `auth.ts` is a `fastify-plugin` decorator (`verifyJwt`, `optionalVerifyJwt`, `requireRight`) visible to all plugins
  - `authRoutes.ts` — routes prefixed `/auth` (register, activate, login, refresh, logout, password reset). Sends `ADMIN_NOTIFY_EMAIL` on new registration
  - Pure utilities: `password.ts`, `jwt.ts`, `rights.ts`, `issueTokens.ts`
  - `passkey/` — WebAuthn passkey routes (`/auth/passkey/*` for registration/login, `/auth/passkeys` for listing/deleting). RP ID configurable via `WEBAUTHN_RP_ID` env var
- **`authNotifier/`** — `fastify-plugin` that decorates `fastify.authNotifier` with an `AuthNotifier` implementation
  - Production (`NODE_ENV=production`): `EmailAuthNotifier` sends via SMTP
  - Dev: `ConsoleAuthNotifier` logs keys to pino
- **`swagger/`** — mounts OpenAPI docs at `/docs` via `@fastify/swagger` + `@fastify/swagger-ui`
- **`sections/`** — routes prefixed `/sections`
- **`thingsOfTheDay/`** — routes prefixed `/things-of-the-day`
- **`users/`** — routes prefixed `/users` (change password, delete account). Sends `ADMIN_NOTIFY_EMAIL` on account deletion
- **`votes/`** — routes prefixed `/things` for voting
  - `PUT /:thingId/vote` — `verifyJwt` + `canVote`. Body `{ vote: 'like' | 'dislike' | null }` — `null` removes the vote. Returns the updated `{ likes, dislikes, userVote }` summary (same shape as the batch GET and comment-vote endpoints). Sends `ADMIN_NOTIFY_EMAIL` on every vote action including removal (fire-and-forget, includes thing title).
  - `GET /votes?thingIds=…` or `?sectionId=…` — `optionalVerifyJwt`. Batch summaries keyed by thingId-as-string: `{ "1": { likes, dislikes, userVote }, ... }`. Anonymous → `userVote: null`. Schema enforces *exactly one* of `thingIds` (1..100 unique positive int ids, comma-separated) or `sectionId` (`section.identifier`, max 64 chars, `[A-Za-z0-9_-]`). `thingIds` mode pre-fills zero summaries for ids with no vote rows so callers get a stable shape. `sectionId` mode joins `v_things_info` to cover every thing in the section (zero-filled for unvoted) and avoids client-side chunking on big `/sections/[id]/all` pages. Vote totals are global (a thing's votes don't change by section).
  - Auth is per-route (`preHandler`), not a plugin-wide `addHook` — the GET needs to coexist with the auth-required PUT. If you add another route here, attach the appropriate preHandler explicitly.
  - On the wire, vote values are strings; the DB column stays `tinyint(-1, 0, 1)`. Translation lives in `lib/voteValue.ts` (`voteValueToDb` / `dbToVoteValue`). The shared `voteSummarySchema` (`{ likes, dislikes, userVote }`) is also exported from `lib/voteValue.ts` and reused by both the thing-vote and comment-vote plugins so the wire shape stays in lockstep across the API. `userVote` fields in any GET response that includes them (thing schema, comment list/single, batch votes summary) follow the same enum.
- **`author/`** — routes prefixed `/author`. `GET /` returns author biography text, date, and optional SEO fields. Sourced from `news` table (id=1). No auth required
- **`comments/`** — routes prefixed `/comments`. Unified site-wide guestbook + per-thing comments in one table; `r_thing_id IS NULL` rows are guestbook entries. One-level threading (a reply's parent must itself be top-level). Post-moderation: new comments default to `Visible` (status 1). Status set: 1=Visible, 2=Hidden (mod-removed), 3=Deleted (self- or admin-removed)
  - Public: `GET /` (paginated by top-level + replies inline; `optionalVerifyJwt` enriches rows with `userVote`), `GET /:commentId` (top-level rows return `replies: []` bundled in for single-thread view; reply rows are returned bare since one-level threading bounds depth), `POST /` (auth + `canComment` bit 4 + rate-limit 1/30s; reply path also fires `commentReplyEmail` to the parent author when the parent is a different, non-banned user), `PUT /:commentId` (own + 15-min edit window), `DELETE /:commentId` (own → status=Deleted), `PUT /:commentId/vote` (auth + `canVote` + rate-limit 5/min, body `{ vote: 'like' | 'dislike' | null }` — `null` removes the vote; self-vote allowed), `POST /:commentId/report` (auth + rate-limit 1/5min, sends `ADMIN_NOTIFY_EMAIL`)
  - Pagination: top-level only, replies always bundled with their parent — keeps trees coherent under append-style "Show more"
  - Tombstones: removed comments are returned only when they have at least one direct visible child (one-level threading bounds the check); text/author/votes are masked client-side via `text=null`, `authorLogin=null`. Replies in non-Visible state are omitted entirely
  - Sanitization: `sanitizeCommentText.ts` (NFC normalize → CRLF→LF → strip control chars → collapse blank-line runs → trim → length 2–4000 → flood reject). Plain-text only; renderers must escape on output
  - Reply notification: deep-link URL points to the parent (top-level), since pagination is on top-level. Shape: `<origin>/sections/<sectionIdentifier>/<positionInSection>?thread=<parentId>` for thing comments, `<origin>/guestbook?thread=<parentId>` for guestbook (no trailing slash before `?` — nextjs convention). Single-thread mode is drift-proof — the link still works regardless of how many comments accumulate later. Frontend reads `?thread=…` and renders only that top-level + its replies via `GET /comments/:commentId`
  - Moderation routes live in `cms/commentsCmsRoutes.ts` (registered by `cmsPlugin`, gated by editor + `canEditContent`): `GET /cms/comments`, `POST /cms/comments/:commentId/{hide,delete,restore}`, `DELETE /cms/comments/:commentId` (hard delete). Hide/delete on a comment auto-resolves any open `comment_report` rows for it
- **`@fastify/rate-limit`** — registered globally with `global: false`; routes opt in via `config: { rateLimit: { max, timeWindow } }`. In-memory store (no Redis), keyed by IP (the rate-limit hook runs before `verifyJwt`)
- **`search/`** — Meilisearch integration. `search.ts` is a `fastify-plugin` that decorates `fastify.meiliClient` (nullable — `null` when `MEILI_MASTER_KEY` is not set). `searchRoutes.ts` provides public `GET /search?q=&limit=&offset=` (always filters `statusId=2`). `searchSync.ts` has `syncThingToSearch` / `deleteThingFromSearch` / `reindexAll`. `textStripping.ts` strips BBCode tags and `{note}` markers for indexing. CMS thing mutations fire-and-forget sync to Meilisearch after DB write. **Index versioning:** `INDEX_VERSION` constant in `search.ts` tracks the indexing schema version. On startup, the plugin compares it against the version stored in a `_meta` Meilisearch index. If they differ, a full reindex runs automatically. Bump `INDEX_VERSION` when changing stripping logic, indexed fields, or document shape.
- **`cms/`** — routes prefixed `/cms`. Two-layer auth: all routes require `verifyJwt` + editor role (`isEditor`); mutations require `canEditContent` right (bit 12). Shared hook in `hooks.ts`. Sub-plugins:
  - `authorRoutes.ts` — GET + PUT `/cms/author` for about page editing
  - `sectionRoutes.ts` — section types, section statuses, sections CRUD + reorder
  - `sectionThingRoutes.ts` — `GET /things` lists all things for the picker + things within sections CRUD + reorder
  - `thingRoutes.ts` — thing CRUD: GET/POST/PUT/DELETE `/cms/things/:thingId` with notes, SEO, info sync + thing statuses/categories reference data. Create/update/delete fire-and-forget sync to Meilisearch
  - `searchCmsRoutes.ts` — `POST /cms/search/reindex` for full reindex of all things
  - `userRoutes.ts` — admin user management. Requires `isAdmin` + `canEditUsers` (bit 14) via `requireAdmin` + `requireCanEditUsers` hooks. Endpoints: `GET /cms/groups`, `GET/POST /cms/users`, `GET/PUT/DELETE /cms/users/:userId`, `POST /cms/users/:userId/resend-activation`, `POST /cms/users/:userId/reset-password`. Self-protection: cannot delete self, change own group, ban self, or remove own `canEditUsers`. On update: bumps `token_version` + deletes refresh tokens. Create sends admin-specific activation email
  - Sections: `statusId` (1=Preparing, 2=Published, 3=Editing, 4=Withdrawn); public API filters `WHERE section_status_id IN (2, 3)`
  - Reorder endpoints accept plain array body `[id1, id2, ...]`
  - Section settings: API `{ showAll, reverseOrder }` ↔ DB `{ show_all, things_order }`; stored as `NULL` when all defaults
  - Reordering things: two-phase UPDATE with high offset to avoid unique constraint conflicts
  - DELETE section: cascades thing_identifiers, refuses if external redirects point in
  - DELETE thing: refuses if thing is in any section

Each route plugin is split into: `*.ts` (handler), `schemas.ts`, `queries.ts`, `databaseHelpers.ts`.

Shared utilities in `src/lib/`:
- `schemas.ts` — Zod schemas (shared `thingSchema`, `errorResponse`)
- `queries.ts` — SQL fragments (thing fields, user vote field)
- `mappers.ts` — row mappers (`mapThingBaseRow`, `splitLines`, `parseJSON`, `thingDisplayTitle`)
- `isoDate.ts` — date format conversion at the wire boundary (`dbDateToIso`, `isoDateToDb`, `isValidIsoDate`)
- `databaseHelpers.ts` — `withConnection` (pool acquire/release)
- `email.ts` — SMTP transport via nodemailer
- `emailTemplates.ts` — email templates:

  | Template | Recipient | Trigger |
  |----------|-----------|---------|
  | `activationEmail` | user | self-registration |
  | `resetPasswordEmail` | user | self-requested password reset |
  | `passwordChangedEmail` | user | password changed |
  | `adminActivationEmail` | user | admin created account |
  | `adminPasswordResetEmail` | user | admin triggered password reset |
  | `adminResendActivationEmail` | user | admin resent activation |
  | `thingVotedEmail` | `ADMIN_NOTIFY_EMAIL` | vote cast/removed |
  | `accountRegisteredEmail` | `ADMIN_NOTIFY_EMAIL` | new user registered |
  | `accountDeletedEmail` | `ADMIN_NOTIFY_EMAIL` | user deleted account |
  | `commentReportedEmail` | `ADMIN_NOTIFY_EMAIL` | user reported a comment |
  | `commentReplyEmail` | parent comment author | someone replied to their comment (skipped on self-reply, deleted author, banned) |
- `maskEmail.ts` — masks emails for logging
- `authNotifier/` — `AuthNotifier` interface, `EmailAuthNotifier` (production), `ConsoleAuthNotifier` (dev)

Plugin schemas extend or re-export from `src/lib/schemas.ts`. Auth notifications use `fastify.authNotifier`; admin notifications use `sendEmail` directly (fire-and-forget).

Validation and serialization use `fastify-type-provider-zod`. All Fastify route schemas reference Zod objects.

## Key Patterns

**Types are derived from Zod schemas** — never write standalone TypeScript interfaces for data that already has a Zod schema. Use `z.infer<typeof Schema>`. All type names use PascalCase.

**Type-only imports** use `import type` (or inline `type` for mixed imports).

**Audio attachments** in `thingSchema` (`src/lib/schemas.ts`) — each audio item has `preload?: 'none'`, `title?: string`, and `sources` (array of `{src, type: 'audio/mpeg'}`). The `title` field is optional and used by the frontend audio player as the track display name.

**Notes aggregation** uses a correlated subquery with `GROUP_CONCAT(JSON_QUOTE(text) ORDER BY id SEPARATOR ',')` wrapped in `CONCAT('[', ..., ']')` (legacy pattern — `JSON_ARRAYAGG` is available on the current MySQL 8.4.8 if refactored).

**`things-of-the-day` selection** — primary query matches by `MM-DD` ignoring year via `SUBSTRING(thing_finish_date, 6)`, also handles partial dates (`YYYY-MM-00`, `YYYY-00-00`), ordered newest year first. Fallback uses `RAND(TO_DAYS(CURDATE()))` seeded by date for stable daily randomness. Results are grouped by `thing_id` in the app to collect `sections: [{id, position}]`.

**Date format** — thing dates support partial precision. DB columns (`thing.start_date`, `thing.finish_date`) are MySQL `DATE` storing `YYYY-MM-DD` with `00` segments for unknown month/day (e.g. `1990-05-00` = May 1990, `1990-00-00` = year 1990, `0000-00-00` = undated). On the wire the api speaks ISO partial: `YYYY` | `YYYY-MM` | `YYYY-MM-DD`. `lib/isoDate.ts` does the conversion: `dbDateToIso` trims trailing `-00` segments on read (in `mapThingBaseRow` and `cms/databaseHelpers.ts:getCmsThing`); `isoDateToDb` pads back to `YYYY-MM-DD` for INSERT/UPDATE (in `cms/databaseHelpers.ts:createThing`/`updateThing`). The Zod `partialDate` validator in `cms/schemas.ts` accepts only the ISO partial form, including a day-in-month check for full dates. `news.date` is exact-only and round-trips unchanged. The `things-of-the-day` SQL still works on raw DB form because it runs server-side before the mapper.

**`withConnection(mysql, fn)`** in `src/lib/databaseHelpers.ts` — shared helper for all DB access; handles pool acquire/release via try/finally. MySQL server timezone is set to `+03:00` (Moscow) via `default-time-zone` in `mysql.cnf` — all `NOW()`, `CURDATE()`, and timestamp comparisons run in Moscow time. Verification key TTL checks use `Date.now()` (Node.js clock, UTC epoch) against the key's embedded timestamp (also `Date.now()` at generation) — self-consistent regardless of server timezone. These two clocks (DB server vs Node.js) don't cross.

**Logging** uses `pino-pretty` only when `NODE_ENV !== 'production'`; raw Pino otherwise.

**Deployment**: image at `ghcr.io/mellonis/poetry-api`. Workflow pattern lives in `mellonis/vps` (`vps/CLAUDE.md`). PRs touching only `.md` files, `api.http`, or `smoke-test*.sh` skip the workflow entirely. When upgrading Node.js, keep the version in sync across `Dockerfile`, `.github/workflows/deploy.yml` (`node-version`), `tsconfig.json` (`@tsconfig/nodeXX`), and `package.json` (`@tsconfig/nodeXX` + `@types/node`).
