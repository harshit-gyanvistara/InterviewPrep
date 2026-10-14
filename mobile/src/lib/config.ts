// The Next.js web app this shell renders. Point it at your LAN IP (e.g. http://192.168.1.20:3000)
// when testing against `next dev` on a physical device — `localhost` resolves to the device itself,
// not your computer. Set EXPO_PUBLIC_WEB_URL in mobile/.env for local overrides.
export const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "https://offerly.app";

export const WEB_APP_ORIGIN = new URL(WEB_APP_URL).origin;
