package com.tasks.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class ForegroundTrackerTest {
    @Test public void previousActivityStoppingDoesNotClearCurrentActivity() {
        ForegroundTracker t = new ForegroundTracker();
        t.accept(1,"tasks","Main"); t.accept(2,"tasks","Main");
        t.accept(1,"tasks","Companion"); t.accept(23,"tasks","Main");
        assertEquals("tasks",t.app); assertEquals("Companion",t.activity);
    }
    @Test public void replayRecoversDelayedResumeAndIsRepeatable() {
        ForegroundTracker t = new ForegroundTracker();
        for(int i=0;i<2;i++) {t.accept(1,"old","A");t.accept(2,"old","A");t.accept(1,"new","B");}
        assertEquals("new",t.app);
        assertTrue(ForegroundTracker.queryStart(100000,false)<99000);
    }
    @Test public void currentPauseHidesAndStartupFindsOlderActivity() {
        ForegroundTracker t = new ForegroundTracker();t.accept(1,"bank","A");t.accept(2,"bank","A");
        assertEquals("",t.app);
        assertTrue(ForegroundTracker.queryStart(86400000,true)<86400000-10000);
    }
}
