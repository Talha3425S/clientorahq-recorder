# ClientoraHQ Recorder architecture

## Current application

The Vite/React client captures and edits media in the browser. The local library uses IndexedDB. An Express API now supports email OTP signup and PostgreSQL-backed sessions; cloud recording upload remains a later capability. Keep local capture available as a private, zero-setup mode.

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

- **Web client:** retain Vite and React. Introduce an API client and a storage adapter so local IndexedDB and hosted recordings share the same library UI. Do not upload until the user chooses Share.
- **API:** Node.js/Express owns authentication, authorization, metadata, upload coordination, share links, and cleanup. The current API implements email OTP signup, email verification, and database-backed sessions. Validate request bodies and enforce per-account quotas and rate limits.
- **Database:** PostgreSQL is the source of truth for accounts, sessions, recording metadata, and shares. Store object keys, never permanent public URLs.
- **Media:** private R2 bucket with presigned multipart uploads for large media. The browser uploads directly to R2; the API issues short-lived scoped URLs and verifies completion. Downloads use short-lived signed URLs after access checks. Apply lifecycle cleanup to abandoned multipart uploads and deleted media.
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
| `POST /api/v1/auth/signup/request-otp` | Public, rate limited | Email a one time verification code |
| `POST /api/v1/auth/signup/verify-otp` | Public, rate limited | Verify the code, create account if needed, and establish a session |
| `POST /api/v1/auth/logout` | Same-origin request | Revoke session |
| `GET /api/v1/auth/me` | Session | Return current account |
| `GET /recordings?cursor=&limit=` | Session | List only the signed-in user's ready recordings |
| `POST /recordings` | Session + CSRF | Create metadata and an upload intent; return scoped presigned upload instructions |
| `POST /recordings/:id/complete` | Owner + CSRF | Verify uploaded object, finalize metadata, mark ready |
| `GET /recordings/:id` | Owner | Read metadata and a short-lived download URL |
| `PATCH /recordings/:id` | Owner + CSRF | Rename title |
| `DELETE /recordings/:id` | Owner + CSRF | Mark deleted, remove R2 objects, revoke shares |
| `POST /recordings/:id/shares` | Owner + CSRF | Create a revocable, optionally expiring share URL |
| `DELETE /shares/:id` | Share owner + CSRF | Revoke a share |
| `GET /shares/:token` | Public token | Return read-only metadata and a short-lived playback URL if valid |

Upload intents must bind the object key, maximum content length, and permitted MIME type on the server. Completion must verify the R2 object's existence and measured size before a recording becomes shareable. Use cursor pagination and consistent ownership checks; do not trust an `owner_id` supplied by the browser.

## Rollout

1. Keep local mode as the default and preserve existing IndexedDB recordings.
2. Configure the OTP API with PostgreSQL, SMTP, and managed secrets before enabling account signup in production.
3. Add API authorization before enabling cloud uploads.
4. Add private R2 upload/download flows and explicit upload progress, retry, and cancellation UI.
5. Add share creation, expiry/revocation controls, and a public read-only playback page.
6. Add server-side media processing only after supported formats, retention, quotas, and failure handling are defined.

Cloud sharing should remain labeled unavailable in the product until the API, database, R2 bucket, session secrets, and deployment configuration are provisioned and verified.
