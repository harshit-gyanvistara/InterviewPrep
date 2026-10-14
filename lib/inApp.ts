/**
 * True inside the Offerly mobile app, whose WebView adds "OfferlyApp/<version>" to the user agent
 * (mobile/src/components/WebAppView.tsx). Used to hide sign-in methods that can't work in a WebView,
 * like Google OAuth (plans/auth.md A3).
 */
export const isInApp = (userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent) => /\bOfferlyApp\//.test(userAgent);
