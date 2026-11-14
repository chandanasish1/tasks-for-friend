package com.tasks.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class DogMoodTest {
    @Test public void progressesFromAwakeThroughYawnAndSettleToSleep(){
        assertEquals("awake",DogMood.at(50000));
        assertEquals("awake",DogMood.at(79999));assertEquals("yawn",DogMood.at(80000));
        assertEquals("settle",DogMood.at(85000));assertEquals("settle",DogMood.at(89999));
        assertEquals("sleep",DogMood.at(90000));
        assertEquals("awake",DogMood.at(0));
    }
}
