package com.tasks.app;

/** All apps default to companionship and nudges; unidentified and system surfaces stay hidden. */
final class CompanionPolicy {
    static final int DEFAULT_MODE = 2;
    static boolean visible(String app, int mode, boolean unlocked, long snooze, long now) {
        return unlocked && mode > 0 && mode <= 2 && snooze <= now && app != null && !app.isEmpty()
            && !app.equals("com.android.settings") && !app.contains("permissioncontroller")
            && !app.equals("com.android.systemui");
    }
    static boolean nudge(int mode, long focusUntil, long lastNudge, long taskUntil, String task, long now) {
        return mode == 2 && focusUntil > now && now - lastNudge > 5*60000
            && taskUntil > now && task != null && !task.isEmpty();
    }
}
