# ClientoraHQ Recorder architecture

## Current application

The Vite/React client captures and edits media in the browser. The local library uses IndexedDB. An Express API supports email OTP signup, login, PostgreSQL-backed sessions, owner-scoped recording metadata, and R2-backed upload and playback URLs when R2 credentials are configured. Keep local capture available as a private, zero-setup mode.

## Target shape

```text
React + TypeScript client
        │ HTTPS JSON API, short-lived upload/download URLs
        ▼
Node.js API (Express) ─── PostgreSQL
        │ signed S3 requests
        ▼
Cloudflare R2 ── private objects; delivery through authorized API
```

- **Web client:** retain Vite and React. Keep local IndexedDB available and list hosted recordings alongside it. Upload only when the user chooses **Upload to cloud**.
- **API:** Node.js/Express owns authentication, authorization, metadata, upload coordination, share links, and cleanup. The current API implements email OTP signup/login, owner-scoped recording list/create/rename/delete, signed R2 upload URLs, upload verification, and signed playback URLs. The server generates object keys and never accepts them from the client.
- **Database:** PostgreSQL is the source of truth for accounts, sessions, recording metadata, and shares. Store object keys, never permanent public URLs.
- **Media:** private R2 bucket. The browser uploads directly using a five-minute presigned PUT URL for files up to 4.995 GiB; the API verifies object size and content type before marking a recording ready. Playback and download links are signed for one hour after access checks. Multipart uploads and lifecycle cleanup are future work.
- **Sessions:** the OTP API sets an HttpOnly, SameSite=Lax opaque cookie and persists only its keyed hash in PostgreSQL. Verification creates a 30 day session. Production requires HTTPS and the exact frontend origin is checked on state-changing authentication requests.
- **Processing:** accept supported browser-produced formats as-is initially. Add asynchronous thumbnail/transcode jobs only when needed; store job state in the database and keep the original object private.

## Initial PostgreSQL schema

Use UUID primary keys, `timestamptz` timestamps, foreign keys, and indexes on every owner/listing path. Store sizes and durations as integer bytes and milliseconds.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  email_verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE TABLE otp_challenges (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  sent_in_window integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  object_key text NOT NULL UNIQUE,
  thumbnail_key text,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  status text NOT NULL CHECK (status IN ('uploading','processing','ready','failed','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recordings_owner_created_idx ON recordings(owner_id, created_at DESC)
  WHERE status <> 'deleted';

CREATE TABLE shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shares_recording_id_idx ON shares(recording_id);
```

Generate a random high-entropy share token once, return it to the owner, and persist only its cryptographic hash. Never expose R2 keys or allow a client to select another user's object key. A share grants read-only access to one recording; expiry and revocation are checked before issuing any media URL.

## API contract

All endpoints are versioned under `/api/v1`; JSON errors use `{ "error": { "code", "message" } }`.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /api/v1/auth/signup/request-otp` | Public, rate limited | Email an account verification code |
| `POST /api/v1/auth/signup/verify-otp` | Public, rate limited | Verify the code, create an account, and establish a session |
| `POST /api/v1/auth/login/request-otp` | Public, rate limited | Email a sign-in code |
| `POST /api/v1/auth/login/verify-otp` | Public, rate limited | Verify the code for an existing account and establish a session |
| `POST /api/v1/auth/logout` | Same-origin request | Revoke session |
| `GET /api/v1/auth/me` | Session | Return current account |
| `GET /api/v1/recordings` | Session | List the signed-in user's non-deleted recordings (up to 100) |
| `POST /api/v1/recordings` | Session + same-origin | Create metadata and return a short-lived, content-type-scoped R2 PUT URL |
| `PATCH /api/v1/recordings/:id` | Owner + same-origin | Rename a recording |
| `DELETE /api/v1/recordings/:id` | Owner + same-origin | Delete the R2 object and mark the recording deleted |
| `POST /api/v1/recordings/:id/complete` | Owner + same-origin | Verify uploaded object size/type and mark ready |
| `GET /api/v1/recordings/:id` | Owner | Read metadata and a one-hour playback URL |
| `GET /api/v1/recordings/:id/download` | Owner | Return an attachment URL for a ready recording |
| `POST /api/v1/recordings/:id/shares` | Owner + same-origin | Create a revocable, optionally expiring share URL |
| `DELETE /api/v1/shares/:id` | Share owner + same-origin | Revoke a share |
| `GET /api/v1/shares/:token` | Public token | Return read-only metadata and a short-lived playback URL if valid |

Upload intents bind the generated object key and permitted MIME type on the server. The current single-PUT endpoint limits declared size to 4.995 GiB; completion verifies the R2 object's measured size and MIME type before a recording becomes playable. Configure bucket CORS to allow the frontend origin to send `PUT` with `Content-Type`. Treat presigned URLs as bearer tokens and keep their lifetime short. Use cursor pagination and consistent ownership checks; do not trust an `owner_id` supplied by the browser.

## Rollout

1. Keep local mode as the default and preserve existing IndexedDB recordings.
2. Configure the OTP API with PostgreSQL, SMTP, and managed secrets before enabling account signup and login in production.
3. Add API authorization before enabling cloud uploads. (Implemented for recording endpoints.)
4. Add upload progress, retry/cancellation, and multipart uploads for large videos. (The initial client integration is implemented.)
5. Add share creation, expiry/revocation controls, and a public read-only playback page.
6. Add server-side media processing only after supported formats, retention, quotas, and failure handling are defined.

Cloud sharing should remain labeled unavailable in the product until the API, database, R2 bucket, session secrets, and deployment configuration are provisioned and verified.
