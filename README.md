# ClientoraHQ Recorder

[**Open the live recorder**](https://clientorahq-recorder-three.vercel.app/)

A browser based screen recorder built with React, TypeScript, and Vite. Screen video, microphone audio, and the optional camera bubble are composed locally; recordings are stored in IndexedDB and are not uploaded.

## Email signup and OTP API

The `/signup` page requests a six digit email code for account creation; `/login` requests a sign-in code for an existing account. The Express API stores only a keyed hash of each code, expires codes after 10 minutes, allows at most five verification attempts, limits resends, and creates an HttpOnly session cookie after verification. A successful signup or login redirects to the recorder dashboard. The existing dashboard and its local recordings continue to work without an account.

OTP signup and login require PostgreSQL and an SMTP account. Configure both before starting the API:

1. Create a PostgreSQL database, then copy `.env.example` to `.env` and set `DATABASE_URL`, the SMTP values, `SMTP_FROM`, and two independent random values for `OTP_SECRET` and `SESSION_SECRET`.
2. Set `APP_ORIGIN` to the exact browser origin. For the default local Vite URL, use `http://localhost:5173`.
3. In one terminal run `npm run server` (API on port 3001).
4. In another terminal run `npm run dev` and open the Vite URL. Click the account avatar or visit `/signup` to create an account. Use `/login` to sign in.

The API creates the auth tables on startup. In production, use HTTPS, a managed PostgreSQL service, real SMTP credentials, and a strong secret manager. The production frontend and API must be served on the same origin or configured behind a reverse proxy; the session cookie is Secure in production. Do not commit `.env` or use the sample credentials.

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
- Local IndexedDB library with thumbnails, dates, durations, playback, rename, download, and delete.
- Permission and device errors are shown in the UI. Stopping screen sharing ends the recording and releases capture tracks.

## Browser coverage

Designed for current desktop Chrome, Edge, and Firefox. This project has not yet been manually tested across those browsers; screen capture audio and MP4 support depend on each browser and the choices made in its share dialog. Mobile browsers that do not provide `getDisplayMedia` show a compatibility message.

## Known improvements

- Run and document a manual browser matrix for Chrome, Edge, and Firefox, including audio synchronization and trim output.
- Add automated browser tests for the recorder lifecycle and IndexedDB library.
- Add hosted recording sharing only after explicit storage and privacy requirements are defined.

All recording and trimming happens in the browser. The app does not send recordings to a server.
