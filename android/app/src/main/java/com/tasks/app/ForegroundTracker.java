package com.tasks.app;

/** Replays overlapping event windows. A previous activity stopping must not hide its successor. */
final class ForegroundTracker {
    String app = "", activity = "";
    void accept(int type, String pkg, String cls) {
        if (type == 1) { app = pkg == null ? "" : pkg; activity = cls == null ? "" : cls; }
        else if ((type == 2 || type == 23) && app.equals(pkg) && activity.equals(cls)) clear();
    }
    void clear() { app = ""; activity = ""; }
    static long queryStart(long now, boolean first) { return now - (first ? 86400000L : 60000L); }
}
