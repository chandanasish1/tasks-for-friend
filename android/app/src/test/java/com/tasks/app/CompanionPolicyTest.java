package com.tasks.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class CompanionPolicyTest {
    @Test public void hidesUnknownLockedSnoozedAndSystemApps() {
        assertFalse(CompanionPolicy.visible("bank.example",0,true,0,100));
        assertFalse(CompanionPolicy.visible("",1,true,0,100));
        assertFalse(CompanionPolicy.visible("allowed",1,false,0,100));
        assertFalse(CompanionPolicy.visible("allowed",1,true,200,100));
        assertFalse(CompanionPolicy.visible("com.android.settings",2,true,0,100));
        assertFalse(CompanionPolicy.visible("com.google.android.permissioncontroller",2,true,0,100));
        assertTrue(CompanionPolicy.visible("allowed",1,true,0,100));
    }
    @Test public void nudgesRequireFocusFreshTaskAndCooldown() {
        long now=1000000;
        assertTrue(CompanionPolicy.nudge(2,now+1000,0,now+1000,"Report",now));
        assertFalse(CompanionPolicy.nudge(1,now+1000,0,now+1000,"Report",now));
        assertFalse(CompanionPolicy.nudge(2,now-1,0,now+1000,"Report",now));
        assertFalse(CompanionPolicy.nudge(2,now+1000,now-1000,now+1000,"Report",now));
        assertFalse(CompanionPolicy.nudge(2,now+1000,0,now-1,"Report",now));
        assertFalse(CompanionPolicy.nudge(2,now+1000,0,now+1000,"",now));
    }
}
