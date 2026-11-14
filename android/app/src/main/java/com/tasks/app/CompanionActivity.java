package com.tasks.app;

import android.app.*;
import android.content.*;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.widget.*;
import java.util.*;

/** Native setup keeps permission handling out of the web task UI. */
@androidx.annotation.RequiresApi(26)
public class CompanionActivity extends Activity {
    private LinearLayout body;
    private SharedPreferences prefs;
    private TextView status;
    static boolean usageAllowed(Context c) {
        AppOpsManager ops = (AppOpsManager)c.getSystemService(APP_OPS_SERVICE);
        return ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(), c.getPackageName()) == AppOpsManager.MODE_ALLOWED;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("companion", 0);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true); scroll.setBackgroundColor(Color.rgb(249,245,235));
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        scroll.setOnApplyWindowInsetsListener((view,insets)->{
            view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(20),dp(16),dp(20),dp(24)); scroll.addView(body); setContentView(scroll);
        text("A little company", 28);
        PixelDogView dog = new PixelDogView(this);
        body.addView(dog, new LinearLayout.LayoutParams(dp(104),dp(104)));
        text("Choose your companion",20);
        RadioGroup companions=new RadioGroup(this);
        String[] companionNames={"Spaniel", "Corgi", "Calico cat"};
        String[] companionIds={"spaniel", "corgi", "calico"};
        for(int i=0;i<companionNames.length;i++){
            RadioButton choice=new RadioButton(this);choice.setId(100+i);choice.setText(companionNames[i]);
            choice.setTextColor(Color.rgb(65,51,44));choice.setTextSize(16);companions.addView(choice);
            if(companionIds[i].equals(prefs.getString("species","spaniel")))companions.check(100+i);
        }
        companions.setOnCheckedChangeListener((group,id)->{
            if(id>=100&&id<=102){prefs.edit().putString("species",companionIds[id-100]).apply();dog.touch();dog.invalidate();}
        });
        body.addView(companions);
        text("All three share your tap shortcuts and focus nudges. They settle after 85 seconds without touch and sleep at 90 seconds.",14);
        text("Your pixel pup stays nearby in all apps by default. Use App exceptions to hide it in individual apps. Tap to pet, double-tap for Today, triple-tap for Focus. Drag to move, or hold for these controls.", 16);
        status = text("", 15);
        button("1. Allow display over other apps", () -> overlaySettings());
        button("2. Allow usage access", () -> startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)));
        button("3. Allow companion notifications", () -> {
            if(Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 10);
        });
        button("App exceptions", this::chooseApps);
        button("Wake up the dog", () -> {
            if(!Settings.canDrawOverlays(this) || !usageAllowed(this)) {
                Toast.makeText(this,"Allow overlay and usage access first.",Toast.LENGTH_LONG).show(); return;
            }
            if(Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this,"Allow notifications so Stop is always available.",Toast.LENGTH_LONG).show(); return;
            }
            prefs.edit().putLong("snooze",0).apply();
            try { startForegroundService(new Intent(this, CompanionService.class)); }
            catch(RuntimeException e) { Toast.makeText(this,"Android could not start the companion. Try again with Tasks open.",Toast.LENGTH_LONG).show(); }
            refresh();
        });
        button("Let the dog rest — stop all overlays", () -> {stopService(new Intent(this,CompanionService.class)); refresh();});
        text("Gentle focus", 21);
        text("Nudges run during a Focus timer or a focus window you start here. The dog suggests your next unfinished task, with a break or continue option. No screen contents are read or sent anywhere.",16);
        button("Start a 25-minute focus window", () -> {prefs.edit().putLong("focusUntil",System.currentTimeMillis()+25*60000).putLong("snooze",0).apply();refresh();});
        button("End focus window", () -> {prefs.edit().putLong("focusUntil",0).apply();refresh();});
        text("Banking & private apps",21);
        text("Companion + focus nudges is the default for all apps. Set banking, payment or other private apps to Hidden in App exceptions. Android may also hide it on protected screens. App detection has a short delay: this is not a guarantee that a bank will accept an overlay app.",16);
        text("If your bank still objects, stop the dog and turn off ‘Allow display over other apps’ below. Some banks check the permission even when no dog is visible. We do not bypass their protection.",16);
        button("Stop & open overlay permission to turn it off", () -> {stopService(new Intent(this,CompanionService.class));overlaySettings();});
        button("Back to Tasks", () -> {startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish();});
    }
    private void overlaySettings() {startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:"+getPackageName())));}
    private TextView text(String s,int size) {
        TextView v=new TextView(this);v.setText(s);v.setTextSize(size);v.setTextColor(Color.rgb(65,51,44));v.setPadding(0,12,0,12);body.addView(v);return v;
    }
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private void button(String s,Runnable action) {
        Button b=new Button(this);b.setText(s);b.setAllCaps(false);b.setTextSize(15);b.setTextColor(Color.rgb(44,67,54));
        android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.rgb(224,233,215));bg.setCornerRadius(dp(14));b.setBackground(bg);
        b.setPadding(dp(12),dp(10),dp(12),dp(10));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(5),0,dp(5));
        body.addView(b,p);b.setOnClickListener(v->action.run());
    }
    @Override protected void onResume() {super.onResume(); refresh();}
    private void refresh() {
        if(status==null)return;
        status.setText("Overlay: "+(Settings.canDrawOverlays(this)?"allowed":"off")+" · Usage access: "+(usageAllowed(this)?"allowed":"off")
            +"\nFocus window: "+(prefs.getLong("focusUntil",0)>System.currentTimeMillis()?"active":"off")
            +"\nDog: "+(CompanionService.running?"awake":"resting"));
    }
    private void chooseApps() {
        Intent intent=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps=getPackageManager().queryIntentActivities(intent,0);
        TreeMap<String,String> labels=new TreeMap<>();
        for(ResolveInfo r:apps) labels.put(r.activityInfo.packageName,r.loadLabel(getPackageManager()).toString());
        List<String> packages=new ArrayList<>(labels.keySet());
        packages.sort(Comparator.comparing(labels::get,String.CASE_INSENSITIVE_ORDER));
        String[] names=packages.stream().map(p->labels.get(p)+"\n"+p+" · "+modeName(prefs.getInt("app:"+p,CompanionPolicy.DEFAULT_MODE))).toArray(String[]::new);
        new AlertDialog.Builder(this).setTitle("App exceptions (default: nudges)").setItems(names,(d,index)->{
            String p=packages.get(index);
            new AlertDialog.Builder(this).setTitle(labels.get(p)).setSingleChoiceItems(
                new String[]{"Hidden — banking & private apps", "Companion only", "Companion + focus nudges"},prefs.getInt("app:"+p,CompanionPolicy.DEFAULT_MODE),(dialog,which)->{
                    prefs.edit().putInt("app:"+p,which).apply();dialog.dismiss();chooseApps();
                }).setNegativeButton("Cancel",null).show();
        }).setNegativeButton("Done",null).show();
    }
    private static String modeName(int mode){return mode==2?"companion + focus nudges":mode==1?"companion":"hidden";}
}
