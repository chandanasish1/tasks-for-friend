# Notifications

Open **Alerts** in the bottom dock, choose **Enable task alerts**, and allow the
system permission. Use **Test notification** to check delivery. Preferences are
per account and device. Disable task alerts cancels pending task reminders;
Focus interval alerts are separate.

Task reminders cover start time, planned duration end, and finish-by deadline.
Routine reminders repeat daily. A duration-only task needs a planned slot first;
a task with neither a time nor a slot does not get an invented reminder.
Active plans use allocated times rather than original preferred times.
Completion, edits, reordering and replanning refresh pending reminders.

Android schedules up to 512 reminders across the next seven days. Reopen the app
to refresh the horizon and changes made on other devices. Notifications remain
subject to Android permission, battery restrictions, and alarm timing. Force-stop
can prevent delivery. Use **Allow precise timing** for exact-alarm access;
routine scheduling never opens that settings screen automatically.

On the website, keep the page open. Browser permission is required. The app checks
every five seconds, suppresses duplicates for a daily occurrence, and allows a
90-second grace period for delayed task alerts. Suspended tabs may deliver late;
closing the page stops reminders. There is no push backend or server subscription.
Clicking a notification focuses an existing app tab or opens the website.

For Focus, use **Enable interval alerts** on the Focus page. Android schedules
interval boundaries; the web shows browser notifications while the page runs.

No database migration is required for this release. Notification preferences
and delivery bookkeeping are local; task schedules still sync through Supabase.
