# Tasks — how the app works

A minimalist task manager. Your lists are columns on a board; on the phone you
swipe between them, on a wide screen they sit side by side ("All tasks" view).
Everything you do syncs live to your private database, so the phone and a
browser always show the same thing.

## Lists — the one rule that matters

**A list's name decides how it behaves.** Lists named exactly `Today`,
`Upcoming`, or `Routine` are smart lists with special behavior (the app blocks
renaming or deleting them). Every other list — `Commitments`, `Academics`, or
anything you create — is a regular list.

### Regular lists

Ordinary one-off tasks, with an optional **due date** (calendar icon) and
**due time** (clock icon, 24-hour dial). Inside a column, tasks group by date
(with headers like "TOMORROW" or "3 DAYS LEFT"), then a **NO DATE** section,
then **COMPLETED** at the bottom. Give a task today's date and it also appears
in Today; a future date sends it to Upcoming.

### Today

Your "what do I do right now" screen. It automatically gathers:

- Its **own tasks** — things you add directly here. They have no date on
  purpose: being in Today *means* due today.
- Every task from any list **due today** (with a badge naming its home list).
- Every **overdue** task — pinned at the very top under a red header, so
  nothing unfinished can get buried.
- All **Routine** tasks, every day.

Drag to reorder inside Today and the home lists reorder to match — and vice
versa. Tasks you complete stay visible (struck through) until midnight.

### Upcoming

A preview of the future: every pending task with a due date after today,
gathered from all lists and grouped by date. You can't add tasks here —
give a task a future date anywhere else and it shows up.

### Routine

Daily habits (gym, meds, reading…). The key rule: **routine tasks are never
deleted by completing them.** Check one off and it sinks to the bottom,
struck through, for the rest of the day — at midnight it resets to pending
and floats back up. Routine tasks appear in Today every day.

## Completing tasks & the midnight clean slate

- Checking a task off strikes it through and sinks it to COMPLETED — it does
  **not** delete it. Tap the checkbox again to undo.
- At **local midnight**: completed one-off tasks are deleted for good, and
  routines reset to pending. Every morning starts clean.
- A task with a due time shows a small **time chip** that turns red once the
  time passes. It's display-only — the app deliberately sends no
  notifications; you check it, it doesn't nag you.

## Everyday use

- **Add a task**: tap "Add a task" at the top of a column, type, press Enter
  (or just tap elsewhere). While typing in a regular list, a calendar button
  appears to set the date immediately.
- **Edit**: click a task (desktop) or double-tap it (mobile). On mobile a
  single tap reveals the action icons first.
- **Date / time / delete**: the calendar, clock, and trash icons on each row.
  Deleting asks for confirmation.
- **Reorder**: press-and-hold briefly, then drag — works for tasks and, via
  the dots handle, for lists in the sidebar.
- **Search**: the sidebar search box finds any task and jumps straight to it.
- **New lists**: "Create New List" in the sidebar; rename/delete via the ⋮
  menu on a column header (long-press the tab on mobile).

## Sync and offline

The little colored **dot** is the sync indicator — tap it to force a sync.
Changes apply on screen instantly and save to your database in the
background; edits from another device appear within a second or two. The
Android app works fully offline: changes queue up and send themselves when
the connection returns.
