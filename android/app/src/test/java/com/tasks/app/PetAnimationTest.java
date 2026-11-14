package com.tasks.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class PetAnimationTest {
    @Test public void timelineHonorsNinetySeconds(){
        assertEquals("idle",PetAnimation.state(79999,false,false));
        assertEquals("prepare",PetAnimation.state(80000,false,false));
        assertEquals("rest",PetAnimation.state(85000,false,false));
        assertEquals("rest",PetAnimation.state(89999,false,false));
        assertEquals("sleep",PetAnimation.state(90000,false,false));
    }
    @Test public void interactionOverridesIdleAndWakePrecedesPet(){
        assertEquals("wake",PetAnimation.state(90000,true,true));
        assertEquals("pet",PetAnimation.state(90000,false,true));
        assertEquals("idle",PetAnimation.state(0,false,false));
    }
    @Test public void sizeCannotEscapeSupportedRange(){
        assertEquals(48,PetAnimation.size(-1));assertEquals(160,PetAnimation.size(999));assertEquals(96,PetAnimation.size(96));
    }
}
