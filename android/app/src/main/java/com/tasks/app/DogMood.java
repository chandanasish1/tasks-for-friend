package com.tasks.app;

/** Timed idle progression, independent of rendering and Android. */
final class DogMood {
    static final long YAWN_AT=80000, SETTLE_AT=85000, SLEEP_AT=90000;
    static String at(long idle) {
        if(idle>=SLEEP_AT)return "sleep";
        if(idle>=SETTLE_AT)return "settle";
        if(idle>=YAWN_AT)return "yawn";
        return "awake";
    }
}
