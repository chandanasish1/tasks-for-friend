package com.tasks.app;

/** Timed idle progression, independent of rendering and Android. */
final class DogMood {
    static String at(long idle) {
        if(idle>=50000)return "sleep";
        if(idle>=45000)return "settle";
        if(idle>=40000)return "yawn";
        return "awake";
    }
}
