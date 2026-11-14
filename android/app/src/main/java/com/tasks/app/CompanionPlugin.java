package com.tasks.app;

import android.content.Intent;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Companion")
public class CompanionPlugin extends Plugin {
    @PluginMethod public void open(PluginCall call) {
        if(android.os.Build.VERSION.SDK_INT < 26) {call.reject("The pixel companion requires Android 8 or later.");return;}
        getActivity().startActivity(new Intent(getContext(), CompanionActivity.class));
        call.resolve();
    }
    @PluginMethod public void sync(PluginCall call) {
        String title = call.getString("title", "");
        getContext().getSharedPreferences("companion", 0).edit()
            .putString("task", title.substring(0, Math.min(180, title.length())))
            .putString("detail", call.getString("detail", ""))
            .putLong("taskUntil", call.getLong("validUntil", 0L)).apply();
        call.resolve();
    }
}
