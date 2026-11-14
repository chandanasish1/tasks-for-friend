# Focus timer

Open **Focus** in the bottom dock. The app opens on Tasks; the timer has its own page with the same monochrome theme and font.

- Choose Classic (25/5/15), Deep (50/10/30), Quick (15/3/10), or enter your own minutes.
- Select an unfinished task or leave Free focus selected. Finishing a timer never completes a task automatically.
- Choose 1–24 focus sessions and separate short/long break frequencies. A long break takes precedence when both are due. Batches end after their final focus interval, without an extra break.
- Start, pause/resume, or end the batch. Elapsed focus time is retained even when a batch is ended early. Paused time and breaks do not count.
- By default, start each next interval explicitly. Automatic mode runs the entire planned sequence even if the app is closed; use it only when you intend to follow the whole batch.
- Set a default daily target in hours, or override a specific date in Daily goal. The heatmap shows focused time per local calendar day, with month navigation and tap/click details. A focus interval crossing midnight is split across both days.
- Running timer/configuration are local to this device. Completed focus segments and daily goal overrides sync through your signed-in account. Avoid running overlapping timers on multiple devices: they count as separate focus activity.

## Database setup

Run `supabase/upgrade-pomodoro.sql` once in your Supabase project's SQL editor (also required for fresh installs after `setup.sql`). This creates `focus_entries` and `focus_goals`, each protected by owner-only row-level security. It does not alter tasks or routine history. No service-role key is needed or should be placed in the client.

Until the migration is applied, the timer, daily goals and heatmap work locally. The panel reports that cloud sync is unavailable. Focus entries remain queued locally and retry on reconnection, reopening, and the Sync history button. Do not clear app storage before syncing. Default timer preferences remain device-local; saved date-specific goals and history are shared.

## Alerts and background behaviour

On Android, tap Enable interval alerts and allow notifications. Precise alarms may require an additional Android settings permission. Native notifications are scheduled for interval boundaries and are cancelled when pausing or ending a batch. System power restrictions (including Android's idle-mode alarm limits) can delay closely spaced alerts. Force-stopping the app can prevent notifications. Actual locked-device delivery still needs verification on your phone.

On the web, Enable interval alerts requests browser notification permission and unlocks sound. The page shows system notifications when an interval ends while it can execute. Keep the page open; suspended or closed browsers cannot guarantee delivery. In both versions, the timer uses stored timestamps, so returning to the app restores the correct remaining time or completed phase. It does not depend on a continuously running one-second counter.

## Validation

`npm test` covers the existing task features and timer arithmetic, interval sequencing, pause accounting, midnight allocation, reload persistence, account isolation, and offline retries.

`node tests/pomodoro.browser.cjs` requires Playwright and Chrome. It runs an isolated local-mode test without real account data, covering desktop/mobile controls, presets, validation, pause/reload, goals and history navigation.

Build Android with the existing Capacitor sync workflow and Gradle. Installation is a separate step; preserve the app's existing data and signing identity.

## Android landscape timer (1.19.0)

Open Focus and tap **Landscape**. The Android activity rotates to sensor landscape and shows a dedicated large timer, phase, session, selected task, and start/pause/resume/end controls. Configuration and history stay on the regular Focus page. **Exit landscape** restores the prior orientation setting; **Back to tasks** also leaves the dedicated layout. Rotating does not restart or modify the timer. Verified on the connected Android phone, including returning to the regular task view.
