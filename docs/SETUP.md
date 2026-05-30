# Production-readiness checklist

What's required outside of code for App Store submission.

## 1. Privacy + Terms hosting (GitHub Pages)

Already written in `/docs`. To make them publicly reachable:

1. Push the repo (already done — `/docs` is on `main`)
2. Go to https://github.com/uigeadall/Ribolov/settings/pages
3. **Build and deployment** → Source = "Deploy from a branch"
4. **Branch** = `main`, **Folder** = `/docs` → Save
5. Wait ~30 seconds, then verify:
   - https://uigeadall.github.io/Ribolov/
   - https://uigeadall.github.io/Ribolov/privacy.html
   - https://uigeadall.github.io/Ribolov/terms.html

The in-app Legal Info screen already links to these URLs.

## 2. Sentry (crash reporting)

The integration is fully wired in `src/services/observability.ts` and
`src/components/ErrorBoundary.tsx`. It just needs a DSN.

1. Sign up at https://sentry.io (free tier: 5k errors/mo + 10k perf/mo)
2. Create a new React Native project, name it `ribolov-app`
3. Copy the DSN (looks like `https://abc123@o123.ingest.sentry.io/456`)
4. Paste into `app.json` → `extra.sentryDsn`
5. Rebuild the app (`npx expo run:ios --device --configuration Release`)

The integration is gated on a non-empty DSN — until then it's a no-op,
so it's safe to ship without it (you just won't see crashes).

In dev mode Sentry is disabled by default so local errors don't waste
your free-tier budget. To force-enable for testing, set
`EXPO_PUBLIC_SENTRY_FORCE=1` in `.env`.

## 3. Apple Developer account (for App Store + TestFlight)

Required to ship beyond your own iPhone. $99/year. Until you have this:

- The app can only run on devices you personally rebuild for (≤3 active
  at a time, 7-day cert lifespan).
- Push notifications, Sign In with Apple, and App Check are disabled
  in the local entitlements file — they require the paid team to sign.
  The capabilities are still declared in `app.json` and will come back
  automatically when an EAS build runs with your paid account.

Path: developer.apple.com → enroll → wait ~24h → confirm in App Store
Connect → install Xcode's new provisioning profiles.

## 4. Firebase App Check (anti-abuse)

Currently disabled (`firebaseAppCheckEnabled: "false"` in app.json).
Re-enable once on a paid Apple account:

1. Register iOS DeviceCheck in Firebase Console → App Check → Apps →
   Add iOS provider → needs Apple .p8 key + Key ID + Team ID
2. Register Android Play Integrity in the same screen
3. Set `firebaseAppCheckEnabled: "true"` in app.json
4. Enforce per-API in Firebase Console (Firestore + Functions)

Without App Check the Firestore is open to any debug-build client.

## 5. App Store assets

When you're ready to submit:

- 5-10 screenshots per device size (or 1 + Apple defaults)
- App description (BG + EN)
- Keywords, category, age rating
- Privacy nutrition labels (declares data collection in App Store Connect)
- Privacy Policy URL: https://uigeadall.github.io/Ribolov/privacy.html
- Support URL: same as above or a separate support page
- Marketing URL (optional)

First submission gets rejected 50% of the time for nitpicks. Plan for
1-2 review cycles.
