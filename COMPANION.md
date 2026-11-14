# Pixel pup (Android 8+)

Open **Pixel pup** in the Tasks dock. Grant display-over-other-apps, Usage Access and notifications. Wake the dog: all apps default to Companion + focus nudges, including newly installed apps. Use **App exceptions** to set individual apps to Hidden or Companion only. Existing explicit app choices are preserved; previously unconfigured apps adopt the new default. Focus nudges still require an active focus window. Tap to pet the dog; double-tap to open the Today list; triple-tap to open the Focus session page. Drag to move it, or hold it for controls. Tap sequences settle after 400 ms so a triple tap does not also trigger Today. The ongoing notification always offers Stop dog.

Start the Focus timer or a 25-minute focus window in companion controls for gentle task suggestions in apps marked for nudges. The local rule chooses today's earliest unfinished deadline, then list order. Suggestions have a five-minute cooldown, dismiss after 20 seconds, and offer opening Tasks, a five-minute break, or continuing. This is a soft intervention, not an app blocker. No AI account or network inference is used.

## Banking compatibility

The service removes its windows when usage events report an app explicitly set to Hidden. Settings, permission controller and System UI are always excluded. It hides while locked or the screen is off and stops if required permissions disappear. It does not use accessibility services or read screen contents. Android's protected-screen overlay suppression remains in effect.

App transitions are polled every 500 ms while unlocked; OEM event delays can be longer. Therefore automatic hiding cannot guarantee that a bank never observes an overlay during transition. Banks may also reject the overlay grant or sideloaded apps even with no active windows. Before banking, use Stop dog; if the bank still objects use **Stop & open overlay permission to turn it off** and revoke the grant. This requires user action; apps cannot silently revoke their own special access. Do not select sensitive apps for companion visibility.

## Lifecycle and privacy

User-started foreground service, no boot receiver or automatic restart. Wake it again after a reboot, force stop, or system termination. Polling and low-frame-rate animation consume battery; real-device battery measurements remain necessary. App modes, position and the current task snapshot are stored in app-private preferences. Usage events are queried locally, never persisted or uploaded. The task snapshot refreshes on local changes and app foreground; changes on another device require opening Tasks. Snapshots expire at local midnight and are not used for nudges until refreshed. Signing out clears the snapshot when the task app processes the auth change.

Play distribution would require declaring the special-use foreground service and satisfying store review. A debug APK is a sideloaded build, not a Play release.

## Verification

Run `npm test`, `node --test tests/companion.test.mjs`, and `gradlew testDebugUnitTest assembleDebug lintDebug` after Capacitor sync. Device checks: initial permissions, chosen-app visibility, double tap, dragging, excluded app transition, screen off/lock, focus nudge/cooldown/break, Stop notification and revocation. Banking acceptance must be checked by the owner in their actual bank apps; never automate authentication or transactions.


## 1.17.2 overlay recovery

Foreground detection now replays overlapping usage-event windows, including a longer startup history, so delayed events or starting after the current activity resumed do not leave the dog hidden. Activity matching prevents an older activity stopping from clearing its replacement within the same app. Service diagnostics expose attachment state and errors without task contents.

Verified on the connected Realme Android phone: overlay attached and visually present on the home screen; detached in Android Settings; reattached on returning home. Android unit tests, build and lint passed. Banking acceptance remains unverified.

## 1.18.0 interaction verification

Replaced the double-tap-only detector with separate pet, Today and Focus actions. The launch keeps the overlay visible while requesting the activity, and a native-to-web route selects the requested page even when Tasks was already open. Single taps produce animated hearts, happy eyes, a bounce, a wag and a speech bubble; idle animation adds curious head tilts. A welcome bubble explains the gestures. Speech bubbles do not depend on a running focus window. Actual Focus timer intervals now enable native nudges and pause/break/end updates clear that timer window.

Verified on the connected phone: single-tap pet animation and speech visible; double tap from another app opens Today; triple tap opens Focus; double tap from Focus returns to Today; triple tap from the home screen opens Focus. JavaScript suite (47 tests), Android tests, APK build and lint passed.
