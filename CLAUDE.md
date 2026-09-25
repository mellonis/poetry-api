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

## Local development with DDEV (recommended)

```bash
ddev start    # builds + starts; first run: mkcert -install, npm install in container
```
API at `https://api.poetry.ddev.site`; cross-project DB (`poetry-db:3306`) and Meilisearch (`poetry-meilisearch:7700`) are reached on the shared `poetry-ddev` Docker network via aliases. Env from `.ddev/config.yaml` (no `.env` file needed locally). `tsx watch` runs as a `web_extra_daemons` entry. For DDEV WebAuthn, `WEBAUTHN_RP_ID=poetry.ddev.site` (not `localhost`) — already set in `.ddev/config.yaml`. See `poetry/CLAUDE.md` § Local development for the full stack.

## Environment

Every variable is documented inline in `.env.example`, with the rationale next to it —
copy that file to `.env` and fill in the blanks. `CONNECTION_STRING`, `JWT_SECRET` and
`ALLOWED_ORIGINS` are validated on startup. SMTP variables are required only in
production (`NODE_ENV=production`); in dev, notifications are logged to the console
instead. Without `MEILI_MASTER_KEY`, search is disabled — sync calls become no-ops and
`GET /search` returns 503. `REVALIDATION_SECRET` + `NEXTJS_REVALIDATE_URL` + `WWW_REVALIDATE_URL` turn on cache revalidation; without the URLs content writes do not clear the site caches (a startup warning says so). The server listens on `0.0.0.0:3000`, overridable via `PORT`.
Key TTL rationale lives in `poetry/docs/auth.md`.

## Architecture

**CORS** is handled by `@fastify/cors`, registered in `src/index.ts` with origins from the `ALLOWED_ORIGINS` env var. Allows `GET`, `POST`, `PUT`, `PATCH`, `DELETE` methods and `Content-Type` + `Authorization` headers.

Fastify app using a plugin-based structure under `src/plugins/`:

**The endpoint catalogue is not duplicated here** — the running server publishes it as
OpenAPI at `/docs` (`@fastify/swagger` + `swagger-ui`, mounted by `src/plugins/swagger/`),
and `src/plugins/` is the map. What follows is the behaviour behind those endpoints that
a schema cannot show.

- **`health/`** — `GET /health` (public, no auth, no rate-limit). Always returns 200 with `{status: 'ok', db: 'ok' | 'error'}`. Probes the DB with `SELECT 1`; `db: 'error'` signals api-alive-but-db-broken. Consumed by the first-run wizard's Page-1 status check and by external monitoring
- **`setup/`** — first-run setup endpoints (public, rate-limited). `GET /setup/status` returns `{schema: {db_reachable, auth_user_table, display_name_col}, has_active_admins, setup_secret_configured, needs_setup}`. `POST /setup/admin` (body `{secret, email, password}`) is gated by `INITIAL_ADMIN_PASSWORD` env, one-shot (refuses when an active admin exists), and on success INSERTs the root admin row (`id=1, login='admin', r_group_id=1, rights=1`) using `bcryptjs`. Plugin-scoped `setErrorHandler` reformats Zod validation errors to `{error: 'validation', issues: [...]}`. Response codes: 201 / 400 / 401 / 409 / 500 / 503. See `docs/superpowers/specs/2026-05-11-first-run-setup-design.md`. `has_active_admins` excludes banned users via JOIN on `auth_group` checking `(u.rights & 4) = 0 AND (g.rights & 4) = 0`
- **`auth/`** — `auth.ts` is a `fastify-plugin` decorator (`verifyJwt`, `optionalVerifyJwt`, `requireRight`) visible to all plugins
  - `authRoutes.ts` — routes prefixed `/auth` (register, activate, login, refresh, logout, password reset, me). Sends `ADMIN_NOTIFY_EMAIL` on new registration. `GET /auth/me` returns the verified session payload (`{id, login, isAdmin, isEditor, rights}`) for any Bearer-authenticated request; consumed by the poetry-nextjs CMS «Типограф» server action to gate ArtLebedev calls on `rights.canEditContent`
  - `passkey/` — WebAuthn passkey routes (`/auth/passkey/*` for registration/login, `/auth/passkeys` for listing/deleting). RP ID configurable via `WEBAUTHN_RP_ID` env var
  - `pat/` — personal access tokens for the MCP endpoint (`/auth/tokens` list/create/revoke under a JWT session; `scope.ts` is the read/editor/admin ceiling model, `token.ts` the `pat_…` format). Only the SHA-256 hash is stored; purged wherever refresh tokens are (password change/reset, admin user update). Creation also requires the session's `tokenVersion` to match the account — password change/reset now bump it, so a leftover access JWT cannot mint a token after the purge. Reference: `poetry/docs/auth.md` § Personal access tokens
- **`authNotifier/`** — `fastify-plugin` that decorates `fastify.authNotifier` with an `AuthNotifier` implementation
  - Production (`NODE_ENV=production`): `EmailAuthNotifier` sends via SMTP
  - Dev: `ConsoleAuthNotifier` logs keys to pino
- **`users/`** — routes prefixed `/users` (change password, delete account, get/update notification settings). Sends `ADMIN_NOTIFY_EMAIL` on account deletion. `GET/PUT /:userId/notification-settings` — self-only (403 otherwise); returns/updates `{ notifyAuthorOnCommentReply, notifyAuthorOnCommentVote }` booleans
- **`votes/`** — routes prefixed `/things` for voting
  - `PUT /:thingId/vote` — `verifyJwt` + `canVote`. Body `{ vote: 'like' | 'dislike' | null }` — `null` removes the vote. Returns the updated `{ likes, dislikes, userVote }` summary (same shape as the batch GET and comment-vote endpoints). Sends `ADMIN_NOTIFY_EMAIL` on every vote action including removal (fire-and-forget, includes thing title).
  - `GET /votes?thingIds=…` or `?sectionId=…` — `optionalVerifyJwt`. Batch summaries keyed by thingId-as-string: `{ "1": { likes, dislikes, userVote }, ... }`. Anonymous → `userVote: null`. Schema enforces *exactly one* of `thingIds` (1..100 unique positive int ids, comma-separated) or `sectionId` (`section.identifier`, max 64 chars, `[A-Za-z0-9_-]`). `thingIds` mode pre-fills zero summaries for ids with no vote rows so callers get a stable shape. `sectionId` mode joins `v_things_info` to cover every thing in the section (zero-filled for unvoted) and avoids client-side chunking on big `/sections/[id]/all` pages. Vote totals are global (a thing's votes don't change by section).
  - Auth is per-route (`preHandler`), not a plugin-wide `addHook` — the GET needs to coexist with the auth-required PUT. If you add another route here, attach the appropriate preHandler explicitly.
  - On the wire, vote values are strings; the DB column stays `tinyint(-1, 0, 1)`. Translation lives in `lib/voteValue.ts` (`voteValueToDb` / `dbToVoteValue`). The shared `voteSummarySchema` (`{ likes, dislikes, userVote }`) is also exported from `lib/voteValue.ts` and reused by both the thing-vote and comment-vote plugins so the wire shape stays in lockstep across the API. `userVote` fields in any GET response that includes them (thing schema, comment list/single, batch votes summary) follow the same enum.
- **`author/`** — routes prefixed `/author`. `GET /` returns author biography text, date, and optional SEO fields. Sourced from `news` table (id=1). No auth required
- **`bookmarks/`** — routes prefixed `/bookmarks`, all under a plugin-wide `verifyJwt` (`onRequest` hook). `GET /` (list the user's bookmarks), `POST /` (add), `DELETE /` (remove), `PUT /order` (reorder, plain array body), `POST /bulk` (bulk-add — used by the nextjs client to sync locally-stored bookmarks on login). Backed by the `bookmark` table (see `poetry/CLAUDE.md` § Semantics the schema doesn't carry); titles derived at read time via `v_things_info`
- **`comments/`** — routes prefixed `/comments`. Unified site-wide guestbook + per-thing comments in one table; `r_thing_id IS NULL` rows are guestbook entries. One-level threading (a reply's parent must itself be top-level). Post-moderation: new comments default to `Visible` (status 1). Status set: 1=Visible, 2=Hidden (mod-removed), 3=Deleted (self- or admin-removed)
  - Public: `GET /` (paginated by top-level + replies inline; `optionalVerifyJwt` enriches rows with `userVote`), `GET /:commentId` (top-level rows return `replies: []` bundled in for single-thread view; reply rows are returned bare since one-level threading bounds depth), `POST /` (auth + `canComment` bit 4 + rate-limit 1/30s; reply path also fires `commentReplyEmail` to the parent author when the parent is a different, non-banned user **and** `notify_author_on_comment_reply = 1`), `PUT /:commentId` (own + 15-min edit window), `DELETE /:commentId` (own → status=Deleted), `PUT /:commentId/vote` (auth + `canVote` + rate-limit 5/min, body `{ vote: 'like' | 'dislike' | null }` — `null` removes the vote; self-vote allowed; on upsert fires `commentVoteEmail` to the comment author when the voter is a different, non-banned user with a non-deleted account **and** `notify_author_on_comment_vote = 1`), `POST /:commentId/report` (auth + rate-limit 1/5min, sends `ADMIN_NOTIFY_EMAIL`)
  - Pagination: top-level only, replies always bundled with their parent — keeps trees coherent under append-style "Show more"
  - Tombstones: removed comments are returned only when they have at least one direct visible child (one-level threading bounds the check); text/author/votes are masked client-side via `text=null`, `authorLogin=null`. Replies in non-Visible state are omitted entirely
  - Sanitization: `sanitizeCommentText.ts` (NFC normalize → CRLF→LF → strip control chars → collapse blank-line runs → trim → length 2–4000 → flood reject). Plain-text only; renderers must escape on output
  - Reply notification: deep-link URL points to the parent (top-level), since pagination is on top-level. Shape: `<origin>/sections/<sectionIdentifier>/<positionInSection>?thread=<parentId>` for thing comments, `<origin>/guestbook?thread=<parentId>` for guestbook (no trailing slash before `?` — nextjs convention). Single-thread mode is drift-proof — the link still works regardless of how many comments accumulate later. Frontend reads `?thread=…` and renders only that top-level + its replies via `GET /comments/:commentId`
  - Moderation routes live in `cms/commentsCmsRoutes.ts` (registered by `cmsPlugin`, gated by editor + `canEditContent`): `GET /cms/comments`, `POST /cms/comments/:commentId/{hide,delete,restore}`, `DELETE /cms/comments/:commentId` (hard delete). Hide/delete on a comment auto-resolves any open `comment_report` rows for it
- **`things/`** — `GET /things/:thingId` (public): one Published thing in the `thingSchema` shape plus `sections: [{id, position}]`, grouped from `v_things_info` rows with the things-of-the-day helper. Shares the `/things` prefix with `votes/`.
- **`revalidate/`** — `fastify-plugin` decorating `fastify.revalidateContent(log, requestId)`: fire-and-forget POSTs to `NEXTJS_REVALIDATE_URL` and `WWW_REVALIDATE_URL` with `X-Revalidation-Secret` (3 s timeout, `warn` on failure). Called by every content-mutating CMS route (things, sections, section membership/order, author). poetry-nextjs no longer invalidates anything itself.
- **`mcp/`** — `ALL /mcp`: MCP Streamable HTTP (SDK v2, `createMcpHandler` + `toNodeHandler`, `responseMode: 'json'` for 2026-era clients; 2025-era clients (Claude Code, flow-assist today) get one SSE frame per POST that closes with the response — no long-lived streams, so nginx is untouched). `patAuth.ts` turns `Authorization: Bearer pat_…` into a principal (anonymous without a header; JWTs are rejected); `catalogue.ts` is the declarative tool list (39 rows mirroring `/cms` and `/admin`, each a REST route + its own schemas + annotations); `bridge.ts` mints a JWT capped to the token's level and calls the route with `fastify.inject`, so the route's hooks are the second rights check. A fresh `McpServer` per request registers only the caller's level — `tools/list` and `tools/call` agree by construction. `catalogue.test.ts` fails CI when a row no longer matches a registered route or a `GET` lacks `readOnlyHint`.
- **`@fastify/rate-limit`** — registered globally with `global: false`; routes opt in via `config: { rateLimit: { max, timeWindow } }`. In-memory store (no Redis), keyed by IP (the rate-limit hook runs before `verifyJwt`)
- **`search/`** — Meilisearch integration. `search.ts` is a `fastify-plugin` that decorates `fastify.meiliClient` (nullable — `null` when `MEILI_MASTER_KEY` is not set). `searchRoutes.ts` provides public `GET /search?q=&limit=&offset=` (always filters `statusId=2`). `searchSync.ts` has `syncThingToSearch` / `deleteThingFromSearch` / `reindexAll`. `textStripping.ts` strips BBCode tags and `{note}` markers for indexing. CMS thing mutations fire-and-forget sync to Meilisearch after DB write. **Index versioning:** `INDEX_VERSION` constant in `search.ts` tracks the indexing schema version. On startup, the plugin compares it against the version stored in a `_meta` Meilisearch index. If they differ, a full reindex runs automatically. Bump `INDEX_VERSION` when changing stripping logic, indexed fields, or document shape.
- **`cms/`** — routes prefixed `/cms`. Two-layer auth: all routes require `verifyJwt` + editor role (`isEditor`); mutations require `canEditContent` right (bit 12). Shared hook in `hooks.ts`. Sub-plugins:
  - `authorRoutes.ts` — GET + PUT `/cms/author` for about page editing. GET returns `{text: '', date: ''}` (200) when the `news` id=1 row is missing — never 404s, so the CMS form renders an editable blank slate on bare install. PUT is an upsert (`INSERT … ON DUPLICATE KEY UPDATE`) so the first save creates the row
  - `thingRoutes.ts` — thing CRUD: GET/POST/PUT/DELETE `/cms/things/:thingId` with notes, SEO, info, review sync + thing statuses/categories reference data. Create/update/delete fire-and-forget sync to Meilisearch. `review` (`thing_review` table) is raw Markdown — no `normalizeLegacyText`; the `emptyToNull` schema transform maps empty/whitespace-only to null, which deletes the row (upsert when truthy, untouched when the field is absent from a PUT — partial updates like the editorial-stamp reset can't clear it)
  - `calendarRoutes.ts` — `GET /cms/things-of-the-day/calendar`: a rolling 365–366-day calendar of the things-of-the-day (today through one year minus a day later), with simulated fallback picks for days that have no anniversary match
  - `userRoutes.ts` — admin user management. Requires `isAdmin` + `canEditUsers` (bit 14) via `requireAdmin` + `requireCanEditUsers` hooks. Endpoints: `GET /cms/groups`, `GET/POST /cms/users`, `GET/PUT/DELETE /cms/users/:userId`, `POST /cms/users/:userId/resend-activation`, `POST /cms/users/:userId/reset-password`. Self-protection: cannot delete self, change own group, ban self, or remove own `canEditUsers`. On update: bumps `token_version` + deletes refresh tokens. Create sends admin-specific activation email
  - Reorder endpoints accept plain array body `[id1, id2, ...]`
  - Section settings: API `{ showAll, reverseOrder }` ↔ DB `{ show_all, things_order }`; stored as `NULL` when all defaults
  - Reordering things: two-phase UPDATE with high offset to avoid unique constraint conflicts
  - DELETE section: cascades thing_identifiers, refuses if external redirects point in
  - DELETE thing: refuses if thing is in any section

Each route plugin is split into: `*.ts` (handler), `schemas.ts`, `queries.ts`, `databaseHelpers.ts`.

Email templates (`src/lib/emailTemplates.ts`) — recipient and trigger per template:

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
| `commentVoteEmail` | comment author | someone liked/disliked their comment (skipped on self-vote, vote removal, deleted author, banned) |

Plugin schemas extend or re-export from `src/lib/schemas.ts`. Auth notifications use `fastify.authNotifier`; admin notifications use `sendEmail` directly (fire-and-forget).

Validation and serialization use `fastify-type-provider-zod`. All Fastify route schemas reference Zod objects.

## Key Patterns

**Types are derived from Zod schemas** — never write standalone TypeScript interfaces for data that already has a Zod schema. Use `z.infer<typeof Schema>`. All type names use PascalCase.

**Type-only imports** use `import type` (or inline `type` for mixed imports).

**Audio attachments** in `thingSchema` (`src/lib/schemas.ts`) — each audio item has `preload?: 'none'`, `title?: string`, and `sources` (array of `{src, type: 'audio/mpeg'}`). The `title` field is optional and used by the frontend audio player as the track display name.

**Notes aggregation** uses a correlated subquery with ``GROUP_CONCAT(JSON_QUOTE(text) ORDER BY `order`, id SEPARATOR ',')`` wrapped in `CONCAT('[', ..., ']')` (legacy pattern — `JSON_ARRAYAGG` is available on the current MySQL 8.4.8 if refactored). Ordering is by the `thing_note.order` column (CMS array position), with `id` as a tiebreak.

**`things-of-the-day` selection** — primary query matches by `MM-DD` ignoring year via `SUBSTRING(thing_finish_date, 6)`, also handles partial dates (`YYYY-MM-00`, `YYYY-00-00`), ordered newest year first. Fallback orders by `MD5(CONCAT(id, ':', TO_DAYS(CURDATE())))` for stable per-day randomness — **not** `RAND(TO_DAYS(CURDATE()))`, because MySQL's optimizer collapses `RAND(constant)` to scan order and doesn't actually randomize (see the in-line comment in `queries.ts`). Results are grouped by `thing_id` in the app to collect `sections: [{id, position}]`.

**Date format** — thing dates support partial precision. DB columns (`thing.start_date`, `thing.finish_date`) are MySQL `DATE` storing `YYYY-MM-DD` with `00` segments for unknown month/day (e.g. `1990-05-00` = May 1990, `1990-00-00` = year 1990, `0000-00-00` = undated). On the wire the api speaks ISO partial: `YYYY` | `YYYY-MM` | `YYYY-MM-DD`. `lib/isoDate.ts` does the conversion: `dbDateToIso` trims trailing `-00` segments on read (in `mapThingBaseRow` and `cms/databaseHelpers.ts:getCmsThing`); `isoDateToDb` pads back to `YYYY-MM-DD` for INSERT/UPDATE (in `cms/databaseHelpers.ts:createThing`/`updateThing`). The Zod `partialDate` validator in `cms/schemas.ts` accepts only the ISO partial form, including a day-in-month check for full dates. `news.date` is exact-only and round-trips unchanged. The `things-of-the-day` SQL still works on raw DB form because it runs server-side before the mapper.

**`withConnection(mysql, fn)`** in `src/lib/databaseHelpers.ts` — shared helper for all DB access; handles pool acquire/release via try/finally. MySQL server timezone is set to `+03:00` (Moscow) via `default-time-zone` in `mysql.cnf` — all `NOW()`, `CURDATE()`, and timestamp comparisons run in Moscow time. Verification key TTL checks use `Date.now()` (Node.js clock, UTC epoch) against the key's embedded timestamp (also `Date.now()` at generation) — self-consistent regardless of server timezone. These two clocks (DB server vs Node.js) don't cross.

**Logging** uses `pino-pretty` only when `NODE_ENV !== 'production'`; raw Pino otherwise.

**Privacy-safe logging** — log call sites MUST NOT include raw `userId`, `user_id`, `login`, or unmasked `email`. Use `actorFingerprint(id)` from `src/lib/actorFingerprint.ts` for actor identity (`HMAC-SHA256` of the user id, truncated to 16 hex chars, keyed by `LOG_HMAC_KEY_CURRENT`). Field naming convention: `actorFingerprint` (action-taker), `subjectFingerprint` (target of an admin action), `recipientFingerprint` (recipient of a notification). Email values use the existing `maskEmail()`. The CI guard at `src/lib/__tests__/no-raw-identifiers.test.ts` blocks regressions. Spec: `mellonis/poetry docs/superpowers/specs/2026-05-05-privacy-safe-logging-design.md`.

**Deployment**: image at `ghcr.io/mellonis/poetry-api`. Workflow pattern lives in `mellonis/vps` (`vps/CLAUDE.md`). PRs touching only `.md` files, `api.http`, or `smoke-test*.sh` skip the workflow entirely. When upgrading Node.js, keep the version in sync across `Dockerfile`, `.github/workflows/deploy.yml` (`node-version`), `tsconfig.json` (`@tsconfig/nodeXX`), and `package.json` (`@tsconfig/nodeXX` + `@types/node`).
