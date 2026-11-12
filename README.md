# ClientoraHQ Recorder

[**Open the live recorder**](https://clientorahq-recorder-three.vercel.app/)

A browser based screen recorder built with React, TypeScript, and Vite. Screen video, microphone audio, and the optional camera bubble are composed locally. Recordings are saved in browser IndexedDB; Business cloud upload and sharing use a private Supabase Storage bucket when configured.

## Email signup and OTP API

The `/signup` page requests a six digit email code for account creation; `/login` requests a sign-in code for an existing account. The Express API stores only a keyed hash of each code, expires codes after 10 minutes, allows at most five verification attempts, limits resends, and creates an HttpOnly session cookie after verification. A successful signup or login redirects to the recorder dashboard. The existing dashboard and its local recordings continue to work without an account.

OTP signup and login require PostgreSQL and an SMTP account. Configure both before starting the API:

1. Create a PostgreSQL database, then copy `.env.example` to `.env` and set `DATABASE_URL`, the SMTP values, `SMTP_FROM`, and two independent random values for `OTP_SECRET` and `SESSION_SECRET`.
2. Set `APP_ORIGIN` to the exact browser origin. For the default local Vite URL, use `http://localhost:5173`.
3. In one terminal run `npm run server` (API on port 3001).
4. In another terminal run `npm run dev` and open the Vite URL. Click the account avatar or visit `/signup` to create an account. Use `/login` to sign in.

### Hosted Supabase PostgreSQL

For Railway or another hosted Node service, use the Supabase PostgreSQL connection string and set `DATABASE_SSL=true`. If Node reports `self-signed certificate in certificate chain`, download the database root certificate from **Supabase Dashboard → Database → SSL Configuration → Download Certificate**. Base64-encode the certificate file and add the result as the secret variable `DATABASE_SSL_CA_BASE64` in Railway. The server decodes that CA and verifies the TLS certificate chain; do not disable certificate verification in production.

On Windows PowerShell, print the base64 value without changing the certificate:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\prod-ca-2021.crt"))
```

Copy the output directly into Railway's `DATABASE_SSL_CA_BASE64` variable, then redeploy. Keep the certificate value in Railway and do not commit it to Git.

The API creates the auth tables on startup. In production, use HTTPS, a managed PostgreSQL service, real SMTP credentials, and a strong secret manager. The production frontend and API must be served on the same origin or configured behind a reverse proxy; the session cookie is Secure in production. Do not commit `.env` or use the sample credentials.

### Vercel frontend with Railway API

`vercel.json` rewrites `/api/*` requests from the Vercel frontend to the Railway API, keeping browser API calls and session cookies on the frontend origin. Set `APP_ORIGIN` in Railway to the exact HTTPS origin of the Vercel deployment (for example, `https://your-project.vercel.app`, with no trailing slash). Redeploy both services after changing the configuration. Confirm the rewrite by opening `https://your-project.vercel.app/api/v1/health`; it should return `{"status":"ok"}`.

## Supabase Storage (free plan)

Cloud uploads and share links use Supabase Storage's S3-compatible API. To configure it:

1. Create a Supabase project on the Free plan and create a **private** Storage bucket named `recordings`.
2. In Storage settings, enable the S3 protocol and generate an S3 access key pair. Copy the endpoint and region shown there.
3. Put the endpoint, region, bucket name, access key ID, and secret access key in `.env` using the `SUPABASE_STORAGE_*` names from `.env.example`. Keep the secret key server-side and never add it to a `VITE_` variable.
4. Restart `npm run server`.

The current Supabase Free plan includes 1 GB of Storage and limits individual files to 50 MB. This app enforces the 50 MB file limit. Supabase also limits free-plan bandwidth, and free projects may pause after inactivity; check Supabase's current [pricing](https://supabase.com/pricing) before using it for shared recordings.

## Slack contact sync

Slack channel sharing can use an incoming webhook. To also sync the workspace directory, create a Slack app and set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_REDIRECT_URI` in `.env`. Add the exact redirect URI `${APP_ORIGIN}/api/v1/workspace/integrations/slack/oauth/callback` to the Slack app's OAuth redirect URLs and enable the user scopes `users:read` and `users:read.email`. In Workspace Settings → Integrations, a workspace admin can connect Slack and choose when to sync contacts. The app imports member names and email addresses, stores the OAuth token encrypted, and removes imported contacts when disconnected. For local development Slack requires a reachable HTTPS callback URL; configure `SLACK_REDIRECT_URI` to that URL and proxy the callback path to the API.

Google Calendar and Outlook Calendar connections are optional. Configure the matching client ID and secret in `.env`; register `${APP_ORIGIN}/api/v1/workspace/integrations/calendar/google/callback` as a Google OAuth web redirect URI and `${APP_ORIGIN}/api/v1/workspace/integrations/calendar/outlook/callback` as a Microsoft web redirect URI (or set provider-specific redirect variables). The Google app needs Calendar read-only access; the Microsoft app needs delegated `Calendars.Read`, `User.Read`, and `offline_access`. Calendar refresh tokens are encrypted with `SESSION_SECRET`. The Meetings page reads events from the next 14 days and lets the signed-in user start a browser recording for an event. The browser still asks the user to select a screen or window; recording does not start automatically. Users can disconnect a calendar from the Meetings page.

## Run locally

```sh
npm install
npm run dev
```

Open the local Vite URL in a desktop browser. Screen capture requires a secure context; `localhost` is supported. To create a production build, run `npm run build`.

## Features

- Capture a screen, application window, or browser tab with microphone and optional system/tab audio.
- Optional round camera bubble, with corner placement and camera controls.
- Microphone level meter, 3 second countdown, pause/resume, restart, cancel, elapsed timer, and a 5 minute default limit with a 30 second warning.
- Preview and trim the recording, edit its title, save it to the library, or export it as WebM or MP4 when the browser supports that format.
- Optional live captions in browsers that support Web Speech recognition. Recognition uses the browser speech service and may process microphone audio online; recordings remain in local browser storage.
- Local IndexedDB library with animated GIF thumbnails, dates, durations, playback, rename, download, and delete.
- Permission and device errors are shown in the UI. Stopping screen sharing ends the recording and releases capture tracks.

## Browser coverage

Designed for current desktop Chrome, Edge, and Firefox. This project has not yet been manually tested across those browsers; screen capture audio and MP4 support depend on each browser and the choices made in its share dialog. Mobile browsers that do not provide `getDisplayMedia` show a compatibility message.

## Known improvements

- Run and document a manual browser matrix for Chrome, Edge, and Firefox, including audio synchronization and trim output.
- Add automated browser tests for the recorder lifecycle and IndexedDB library.
- Add resumable uploads for large files if the storage provider or plan allows files larger than 50 MB.

Recording composition and trimming happen in the browser. Cloud uploads are sent directly to Supabase Storage through short-lived signed URLs; the API stores recording metadata in PostgreSQL.
