# Daily planning

The app opens on Tasks / Today. Focus is a separate page in the bottom dock.

Use a task's clock button to set a day, duration, time, both duration and time,
or neither. A time can be a start time or a finish-by deadline. Start times can
be rigid or flexible. Existing timed tasks default to rigid until you change them.

Tap **Start my day** to plan from now. **Replan from now** discards current slot
assignments and calculates again. Tomorrow supports choosing a preview start time.
Only events in this app are used; there is no Google Calendar integration.

**Start tomorrow at** is a planning start time, not a countdown. Choose the time
you expect to begin, then press Plan tomorrow. The initial suggestion is 08:00;
it is not an inferred wake time and can be changed.

Routine tasks repeat in both Today and Tomorrow. Their duration, start/deadline
time and rigidity apply each day. Completing today's occurrence leaves tomorrow
pending. Tomorrow's routine checkbox is a preview; complete today's routine in
Today or Routine. Editing a routine schedule changes its recurring template.

## Scheduling rules

- Rigid start times remain fixed. Overlaps and overdue rigid events are flagged.
- Flexible timed tasks preserve their preferred starts when possible. A delay
  propagates only to tasks it actually displaces, stopping when there is enough slack.
- A flexible timed task cannot cross its next rigid event. If it cannot fit,
  it remains overdue with its original time, as in the supplied handwritten examples.
- Duration-only tasks fill available gaps. Smaller tasks can use gaps that larger
  tasks cannot fit. Finish-by tasks take priority and missed deadlines are explicit.
- Up/down controls set flexible-task priority for that day. Rigid events remain
  anchored. Time constraints can override the chosen order.
- An allocated task keeps its slot while that slot is in progress. If still
  unchecked after the slot ends, gap work is assigned the next available space.
- Completed tasks are excluded. No duration is invented for a task without one.
  Work that cannot fit before midnight is labelled instead of silently spilling over.

Example: flexible 06:30 / 15 min, rigid 07:15 / 40 min, flexible 08:30 / 30 min.
Starting at 06:45 gives 06:45, 07:15, 08:30. Starting at 07:10 leaves the first
task overdue and the others unchanged. Making the second task flexible instead
gives 07:10, 07:25, 08:30.

The open app refreshes an active plan every 30 seconds and on returning to the
foreground. It does not infer whether you actually worked, and does not run a
background scheduling service while closed. Mark tasks complete to release their space.
Starting or refreshing a plan changes displayed allocations, not your original times.

## Storage and setup

Task scheduling fields and daily priorities sync with task records after applying
`supabase/upgrade-day-planner.sql`. The active day's start and transient allocations
are stored per account on this device. Another device can start its own plan.
Pomodoro cloud history separately needs `supabase/upgrade-pomodoro.sql`.

`npm test` includes all three handwritten examples, gap filling, live reflow,
overlaps, daily priorities, deadlines and day boundaries. The browser smoke test
uses isolated local data and covers the schedule editor and Tasks/Focus navigation.
