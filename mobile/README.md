# Offerly (mobile)

A thin Expo shell around the Next.js web app in the repo root. There are no native screens here —
the single route in `src/app/index.tsx` renders a full-screen `WebView` pointed at the web app, which
already owns its own navigation, bottom tab bar, and theming. This project's job is just to make that
page feel like a native container: no browser chrome, native back-button handling, camera/mic
permissions wired through for the interview flow, and external links breaking out to the system browser.

## Running it

1. Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_WEB_URL`:
   - Simulator only: `http://localhost:3000` works.
   - Physical device: use your computer's LAN IP, e.g. `http://192.168.1.20:3000` — the device can't
     resolve `localhost` to your machine.
   - Against a deployed build: point it at that URL instead.
2. In the repo root, run the web app: `npm run dev`.
3. In `mobile/`, run `npm start` and open in a dev build or simulator (`npm run ios` / `npm run android`).

This app uses native modules (`react-native-webview`) and camera/mic permissions, so it needs a
development build (`npx expo run:ios` / `npx expo run:android`, or `eas build --profile development`) —
it will not run inside Expo Go.

## Known limitation: speech-to-text

The interview flow's live transcription (`lib/useSpeech.ts` in the web app) uses the browser's
`webkitSpeechRecognition` API. Neither Android's System WebView nor iOS's WKWebView implements the
Web Speech API, so live transcription will not work inside this container even though camera/mic
capture does. This is a constraint of wrapping the web app rather than something fixable from the
mobile shell; it would need either a native speech-to-text bridge exposed to the WebView, or a
server-side transcription path in the web app itself.

## Adding/changing screens

Don't — the mobile shell intentionally has exactly one screen. New user-facing functionality belongs
in the web app (`app/` at the repo root); it appears here automatically since the WebView just renders
whatever that app serves.
