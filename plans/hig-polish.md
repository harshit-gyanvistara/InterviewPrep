# Plan: HIG-grounded polish pass

**Status: not started.** Follow-on to `plans/design-refresh.md` (shipped 2026-10-19), which set the
visual system. This pass fixes concrete Apple HIG gaps found in that system's implementation —
tap targets, focus handling, radius/shadow consistency, type scale, and the native wrapper's
status bar, splash, icon, and back-gesture behavior. No visual-direction change; same tokens,
same "calm & premium" look.

## Context

Audit covered `app/globals.css`, `components/Shell.tsx`, `components/MobileNav.tsx`,
`components/ConfirmDialog.tsx`, and the Expo wrapper in `mobile/` against Apple's HIG (translated
via `references/cross-platform.md` since this is Next.js + Expo WebView, not SwiftUI/UIKit).
Color contrast is actually solid everywhere it was checked (6:1–18:1, all above the 4.5:1 WCAG AA
floor used by `accessibility.md`) — this is **not** a contrast-fixing pass. The gaps are tap
targets, keyboard/focus handling, an undocumented radius/shadow scale, a missing heading scale,
and several native-shell details (status bar, splash color, icon variants, Android back gesture)
that only matter because the WebView is presented inside a real native app, so HIG still applies
to the shell around the web content even though the content itself is DOM/CSS.

## Gaps found (prioritized)

### Critical — none
No accessibility failures or convention breaks that confuse people were found.

### High

1. **Status bar hardcoded to light content.** `mobile/src/app/_layout.tsx:9` sets
   `<StatusBar style="light" />` unconditionally. In the app's light theme (default), the header
   background is `--card` (`#ffffff`), so white status-bar icons/text are invisible against it.
   *Fix:* drive `style` from the same theme source the web app uses (`"light"` icons in dark theme,
   `"dark"` icons in light theme), or use `style="auto"` if the WebView's background is read
   reliably enough.
2. **Shared `.btn` class renders ~36px tall** (`app/globals.css:144`, `.6rem` padding + 14px text),
   under HIG's 44×44pt mobile default (above the 28pt minimum, so not a failure, but worth fixing
   since every button in the app inherits it). *Fix:* raise vertical padding to reach ~44px
   effective height on touch viewports, or add a `min-height: 2.75rem` (44px) on `.btn` for
   pointer: coarse media.
3. **Dialog has no focus trap** (`components/ConfirmDialog.tsx:52`). Tab can move focus out of an
   open `ConfirmDialog`/prompt into backdrop-covered content, which `modality.md` expects a modal
   to prevent. *Fix:* trap focus within the dialog (a small `useFocusTrap` hook, or adopt
   `<dialog>`'s native modal semantics via `showModal()`).
4. **No documented radius/shadow scale.** At least 5 radius values (`rounded-full`, `rounded-lg`,
   `rounded-xl`, `rounded-[10px]`, `rounded-[1.75rem]`) and two parallel shadow systems
   (`--shadow-float` vs. raw Tailwind `shadow/shadow-xl/shadow-2xl`) are in active, inconsistent
   use for functionally similar surfaces (`Card` = 12px, `ScoreBadge` = 10px, dialogs/drawer =
   28px). *Fix:* codify in `app/globals.css` — e.g. `--radius-sm` (8px, inputs/chips),
   `--radius-md` (12px, cards), `--radius-lg` (20–28px, dialogs/sheets), pill only for nav
   avatars/tags — and replace ad hoc Tailwind shadow classes with `.glass`/`--shadow-float`
   everywhere a floating surface appears.
5. **No documented heading scale.** `PageTitle` (`components/Shell.tsx:131`) is `text-2xl`/
   `text-[30px]` but Welcome uses `text-[52px]`, Sign-in uses `text-3xl` — no stated relationship
   between them. *Fix:* add 3–4 named heading utilities (e.g. `.h-display`, `.h1`, `.h2`) to
   `globals.css` and migrate the handful of pages using arbitrary `text-[Npx]` headings onto them.

### Medium

6. **Splash/background color mismatch.** `mobile/app.json:10` sets `backgroundColor: "#1b1c2e"`,
   which matches neither the web app's light (`#fafaf9`) nor dark (`#0e0f12`) token — visible as a
   flash of an unrelated color on launch/WebView reload. *Fix:* set to `#0e0f12` (dark `--bg`) to
   match the WebView's own `#1b1c2e`-replacement background in `WebAppView.tsx`'s `styles`, or
   better, read the user's last theme from storage before choosing.
7. **Error/loading overlay ignores safe area** (`mobile/src/components/WebAppView.tsx:94`). If
   `onError`/`onHttpError` fires before the WebView paints, the error text can sit under a notch or
   status bar. *Fix:* wrap `styles.overlay` content in Expo's `SafeAreaView` (or apply
   `useSafeAreaInsets()` padding) rather than a plain absolute-fill `View`.
8. **Android predictive back gesture disabled** (`mobile/app.json:30`,
   `predictiveBackGestureEnabled: false`). Android 14+ users lose the system back animation even
   though `WebAppView.tsx` already drives in-WebView history via `hardwareBackPress`. *Fix:* enable
   it and verify `onNavigationStateChange`'s `canGoBack` still intercepts correctly (predictive back
   previews the transition before committing, which can change timing).
9. **Theme toggle (36×36px) and avatar (32×32px) are below the 44pt mobile default**
   (`components/Shell.tsx:86,94`), always visible with no responsive gate. *Fix:* bump both to
   `h-11 w-11` (44px) on touch breakpoints, or keep the visual size and enlarge only the hit area
   via padding.
10. **No dark/tinted iOS app icon variants** (`mobile/app.json:8`, single `icon.png`). Users on
    iOS 18+ who set Home Screen appearance to dark/tinted get an auto-generated variant instead of
    a designed one. *Fix:* design dark and tinted variants from the existing icon (same approach as
    the Android adaptive icon's foreground/background split) and wire them through Icon Composer /
    Expo's icon config.

## Action items

### Phase 1: native shell (half a day)
1. Fix status bar style to track theme (`mobile/src/app/_layout.tsx`).
2. Fix splash/background color to a real token (`mobile/app.json`).
3. Wrap `WebAppView`'s loading/error overlay in a safe-area-aware container.
4. Re-enable Android predictive back; confirm `canGoBack` handling still works.

### Phase 2: tap targets and focus (half a day)
5. Raise `.btn` and `.input` effective heights toward 44px on touch viewports.
6. Enlarge the theme-toggle and avatar hit areas in `Shell.tsx`.
7. Add a focus trap to `ConfirmDialog` (and `NotesPanel` if it shares the same modal pattern).

### Phase 3: scale cleanup (about 1 day)
8. Add named radius tokens to `app/globals.css`; migrate `Card`, `ScoreBadge`, dialogs, and the
   notes drawer onto them.
9. Replace ad hoc Tailwind `shadow-*` usages with `.glass`/`--shadow-float` where they're standing
   in for the same "floating surface" concept.
10. Add 3–4 named heading utilities; migrate Welcome, Sign-in, and any other arbitrary
    `text-[Npx]` heading onto the scale.

### Phase 4: icon polish (as time allows, needs design input)
11. Design dark/tinted iOS icon variants from the existing mark.

## Verification

- `npm test`, typecheck, lint, build stay green (no logic changes — CSS/markup and a few mobile
  config values only).
- Manual pass: toggle theme light↔dark on web and inside the Expo WebView, confirm the native
  status bar and splash color track it.
- Tab through `ConfirmDialog`/prompt with keyboard only; confirm focus can't escape to the page
  behind it.
- Screenshot every radius/shadow surface (Card, ScoreBadge, ConfirmDialog, NotesPanel) before and
  after Phase 3 to confirm the consolidation didn't flatten intentional hierarchy (e.g. dialogs
  should still read as more "elevated" than inline cards).
- On a real notched device (or iOS Simulator), force a WebView load failure and confirm the error
  text isn't clipped by the status bar/notch.
