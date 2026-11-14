package com.tasks.app;

/** Dispatch only after the sequence ends so triple tap never also opens Today. */
final class TapSequence {
    private int taps;
    void tap(){taps=Math.min(3,taps+1);}
    int finish(){int n=taps;taps=0;return n;}
    void cancel(){taps=0;}
}
