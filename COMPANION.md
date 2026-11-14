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

## Spaniel redesign and idle behavior (1.19.0)

Original ivory-and-ink floppy-eared dog with a cherry collar, cool shadows and a small gold tag. Separate head, ear, tail and body poses replace the old tan sprite. It blinks and looks around, yawns after 40 seconds without touch, lowers itself from 45 seconds, and sleeps after 50 seconds. Sleeping has gentle breathing and a floating Z. Touch wakes it with a 1.4-second stretch; a single tap adds the happy petting reaction. Touching/dragging resets inactivity. Idle time survives overlay removal/recreation while the app process lives. Sleeping does not disable gestures or nudges.

Device verification: sleeping curled pose visible; a tap wakes it and triggers petting/hearts/speech. Landscape Focus layout and return to tasks visually checked. 47 JavaScript tests and Android tests pass; APK build and lint pass.

## Three companions and 90-second sleep (1.20.0)

In **Pixel pup > Choose your companion**, select Spaniel, Corgi or Calico cat. Selection is saved on this device and applies to an existing overlay without restarting it. The original spaniel remains the default. Corgi and calico are original reference-inspired pixel drawings on a 64x48 nearest-neighbor canvas, with distinct coats, ears, tails and resting poses. They share petting, Today/Focus gestures, nudges and privacy exceptions. Dragging animates a moving gait; calico also has an idle grooming motion.

All three now yawn at 80 seconds without touch, settle from 85 seconds and sleep at 90 seconds. Touch/drag resets this idle period and wakes a resting companion. Timing boundary tests verify 50 seconds is awake, 89.999 seconds is still settling, and 90 seconds is sleep. Selector and both new previews were visually checked on the connected phone; Android tests, APK build and lint passed.

## Reference sprites, animation rules and sizing (1.21.0)

The previous corgi/calico redraws and all locomotion code have been removed. `android/app/src/main/assets/pets/` contains the user's two original sheets unchanged. `ReferencePetRenderer` clips only idle, pet, preparation, lying, sleeping and wake/stretch poses. It keys the blue/slate background, retains the largest connected sprite to discard labels/artifacts, preserves source foreground RGB, and uses nearest-neighbor rendering with a fixed source scale and shared baseline. Movement-row frames are never loaded. These are pose transitions, not interpolated walking/running cycles.

### Deterministic behavior

1. Wake/stretch has highest priority for 1.4 seconds after touching a resting pet.
2. A confirmed single tap gives 3.5 seconds of pet reaction after waking (corgi happy pose; calico sitting pose with hearts). Double/triple taps still route to Today/Focus.
3. Otherwise time since the last touch chooses idle [0,80 seconds), preparation [80,85), lying [85,90), or sleep [90,infinity). Preparation uses the corgi yawn or calico grooming pose. Sleeping has only a subtle one-source-pixel breathing offset.
4. Dragging repositions the overlay and cancels taps; no walking, running or jumping pose is triggered. Touch resets the idle timer. There is no random animation selection.

**Pet size** offers 60–200% of the default through a slider and Smaller/Larger buttons. The saved value is bounded to 48–160 dp in 8-dp steps. Preview and running overlay resize immediately; the overlay position is clamped to the screen, including orientation changes. The **Animation behavior** button explains the rules in-app.

Device checks: original idle corgi and calico visually verified; live overlay increased from 280 to 308 physical pixels at 100→110%, then returned to 280 at 100%. Android build, unit tests and lint passed. Unit tests cover state boundaries, wake/pet precedence and size limits.

## Lively reference companions and quieter dock (1.22.0)

Corgi and calico retain the approved reference artwork. Breathing scales the sprite height by roughly one source pixel with a fixed paw baseline: 3.4-second awake cycles, 4.6-second sleeping cycles. A two-band translucent contact shadow grounds the pet. Pet reactions add a small body pulse and two drifting hearts; sleep adds a fading pixel Z on a three-second cycle. Rendering updates every 80 ms, without walking/running or automatic overlay travel. Sleep still starts at 90 seconds; size controls remain 60–200%.

Pixel pup and Alerts moved from the bottom dock to Settings near the bottom of the scrollable side menu. The dock now contains only Tasks and Focus. Device navigation to the new Pixel pup entry was verified. All 47 JavaScript tests, Android unit tests, APK build and lint pass. The JavaScript checks also fixed an injected-clock mismatch in companion task selection and a test fixture that assumed subtracting 25 hours always meant yesterday.
