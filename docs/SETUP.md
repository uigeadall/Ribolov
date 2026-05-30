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

## 2. Crash reporting (deferred)

Sentry was removed for cost reasons. The ErrorBoundary still catches
React tree crashes and shows a recoverable fallback UI, so the app
doesn't whitescreen, but you won't see remote reports until you wire
something.

When you want crash visibility later, two free options:

- **Firebase Crashlytics** — already integrated with the Firebase
  project; add `@react-native-firebase/crashlytics`, call
  `crashlytics().recordError()` from `captureException` in
  `src/services/observability.ts`. Free.
- **Sentry** — restore from git history (commit `50cb7be`); free tier
  is 5k errors/month.

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
