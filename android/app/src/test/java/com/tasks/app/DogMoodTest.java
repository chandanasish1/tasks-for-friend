package com.tasks.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class DogMoodTest {
    @Test public void progressesFromAwakeThroughYawnAndSettleToSleep(){
        assertEquals("awake",DogMood.at(39999));assertEquals("yawn",DogMood.at(40000));
        assertEquals("settle",DogMood.at(45000));assertEquals("sleep",DogMood.at(50000));
        assertEquals("awake",DogMood.at(0));
    }
}
