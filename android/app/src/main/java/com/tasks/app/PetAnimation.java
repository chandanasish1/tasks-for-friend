package com.tasks.app;

/** Deterministic state priority; no random pose cycling or locomotion. */
final class PetAnimation {
    static String state(long idle, boolean waking, boolean petted) {
        if(waking)return "wake";
        if(petted)return "pet";
        if(idle>=90000)return "sleep";
        if(idle>=85000)return "rest";
        if(idle>=80000)return "prepare";
        return "idle";
    }
    static int size(int requested){return Math.max(48,Math.min(160,requested));}
}
