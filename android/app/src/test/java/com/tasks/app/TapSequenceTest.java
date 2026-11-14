package com.tasks.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class TapSequenceTest {
    @Test public void sequencesDispatchExactlyOneAction(){
        TapSequence t=new TapSequence();
        for(int count=1;count<=3;count++){for(int i=0;i<count;i++)t.tap();assertEquals(count,t.finish());assertEquals(0,t.finish());}
    }
    @Test public void dragOrLongPressCancelsTap(){TapSequence t=new TapSequence();t.tap();t.cancel();assertEquals(0,t.finish());}
}
