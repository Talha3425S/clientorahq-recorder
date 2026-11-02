# ClientoraHQ Recorder

[**Open the live recorder**](https://clientorahq-recorder-three.vercel.app/)

A browser based screen recorder built with React, TypeScript, and Vite. Screen video, microphone audio, and the optional camera bubble are composed locally; recordings are stored in IndexedDB and are not uploaded.

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
- Add optional hosted sharing only after explicit storage and privacy requirements are defined.

All recording and trimming happens in the browser. The app does not send recordings to a server.
