package com.tasks.app;

import android.app.*;
import android.app.usage.*;
import android.content.*;
import android.graphics.PixelFormat;
import android.graphics.Color;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;

@androidx.annotation.RequiresApi(26)
public class CompanionService extends Service {
    static volatile boolean running;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private WindowManager windows;
    private View dog, bubble;
    private WindowManager.LayoutParams dogParams;
    private SharedPreferences prefs;
    private String foreground="";
    private final ForegroundTracker tracker=new ForegroundTracker();
    private String lastError="";
    private int eventCount;
    private boolean nudgeBubble, greeted;
    private String lastGesture="none";
    private final TapSequence taps=new TapSequence();
    private final Runnable finishTaps=()->handleTaps(taps.finish());
    private long lastQuery, lastNudge;
    private final Runnable dismissBubble=()->hideBubble();
    private final Runnable poll=new Runnable(){public void run(){
        if(!Settings.canDrawOverlays(CompanionService.this)||!CompanionActivity.usageAllowed(CompanionService.this)) {stopSelf();return;}
        PowerManager power=(PowerManager)getSystemService(POWER_SERVICE);
        KeyguardManager lock=(KeyguardManager)getSystemService(KEYGUARD_SERVICE);
        if(!power.isInteractive()||lock.isKeyguardLocked()){ hideAll(); foreground=""; tracker.clear(); lastQuery=0;handler.postDelayed(this,1000);return; }
        long now=System.currentTimeMillis();
        try {
            UsageStatsManager usage=(UsageStatsManager)getSystemService(USAGE_STATS_SERVICE);
            UsageEvents events=usage.queryEvents(ForegroundTracker.queryStart(now,lastQuery==0),now);
            lastQuery=now;
            eventCount=0;
            if(events==null){tracker.clear();} else {
                UsageEvents.Event e=new UsageEvents.Event();
                while(events.hasNextEvent()) {
                    events.getNextEvent(e);
                    eventCount++;
                    tracker.accept(e.getEventType(),e.getPackageName(),e.getClassName());
                }
            }
            foreground=tracker.app;
            int mode=prefs.getInt("app:"+foreground,CompanionPolicy.DEFAULT_MODE);
            if(!CompanionPolicy.visible(foreground,mode,true,prefs.getLong("snooze",0),now))hideAll();
            else {
                showDog();
                if(dog!=null && !greeted){greeted=true;say("I am here! Tap to pet me. Double-tap for Today; triple-tap for Focus.");}
                if(CompanionPolicy.nudge(mode,Math.max(prefs.getLong("focusUntil",0),prefs.getLong("timerUntil",0)),lastNudge,
                    prefs.getLong("taskUntil",0),prefs.getString("task",""),now)) {
                    showNudge();lastNudge=now;
                }
                if(nudgeBubble && (mode!=2 || Math.max(prefs.getLong("focusUntil",0),prefs.getLong("timerUntil",0))<=now || prefs.getString("task","").isEmpty()))hideBubble();
            }
        } catch(RuntimeException e){lastError=e.toString();android.util.Log.e("PixelCompanion","Polling failed",e);foreground="";tracker.clear();hideAll();}
        handler.postDelayed(this,500);
    }};
    @Override public void onCreate(){
        super.onCreate();prefs=getSharedPreferences("companion",0);windows=(WindowManager)getSystemService(WINDOW_SERVICE);
        NotificationManager manager=getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("companion","Pixel dog companion",NotificationManager.IMPORTANCE_LOW));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&"stop".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        PendingIntent settings=PendingIntent.getActivity(this,20,new Intent(this,CompanionActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,21,new Intent(this,CompanionService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n=new Notification.Builder(this,"companion").setSmallIcon(android.R.drawable.ic_menu_agenda)
            .setContentTitle("Your pixel dog is nearby").setContentText("Visible by default. Tap to manage app exceptions.")
            .setContentIntent(settings).setOngoing(true).addAction(new Notification.Action.Builder(null,"Stop dog",stop).build()).build();
        startForeground(4701,n);running=true;handler.removeCallbacks(poll);handler.post(poll);return START_NOT_STICKY;
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private WindowManager.LayoutParams params(int width,int height){
        WindowManager.LayoutParams p=new WindowManager.LayoutParams(width,height,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT);
        p.gravity=Gravity.TOP|Gravity.LEFT;return p;
    }
    private void open(Class<?> activity){
        // Keep the visible overlay attached during this user-initiated launch.
        startActivity(new Intent(this,activity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP));hideBubble();
    }
    private void navigate(String route){prefs.edit().putString("route",route).apply();open(MainActivity.class);}
    private void handleTaps(int count){
        lastGesture=count==1?"pet":count==2?"today":count==3?"focus":"none";
        if(count==1){
            if(dog instanceof PixelDogView)((PixelDogView)dog).pet();
            String task=prefs.getLong("taskUntil",0)>System.currentTimeMillis()?prefs.getString("task",""):"";
            say(task.isEmpty()?"That is the spot! I am right here with you.":"That is the spot!\nWhen you are ready: "+task);
        } else if(count==2)navigate("today");else if(count==3)navigate("focus");
    }
    private void say(String text){
        hideBubble();nudgeBubble=false;
        TextView label=new TextView(this);label.setText(text);label.setTextSize(15);label.setTextColor(Color.rgb(65,51,44));
        label.setPadding(dp(14),dp(10),dp(14),dp(10));
        android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();bg.setColor(Color.rgb(255,245,222));bg.setCornerRadius(dp(14));label.setBackground(bg);
        WindowManager.LayoutParams p=params(Math.min(dp(260),getResources().getDisplayMetrics().widthPixels-dp(24)),WindowManager.LayoutParams.WRAP_CONTENT);
        p.x=Math.max(dp(12),Math.min(dogParams==null?dp(12):dogParams.x,getResources().getDisplayMetrics().widthPixels-p.width-dp(12)));
        p.y=Math.max(dp(40),Math.min(dogParams==null?dp(80):dogParams.y+dp(90),getResources().getDisplayMetrics().heightPixels-dp(240)));
        bubble=label;try{windows.addView(label,p);handler.postDelayed(dismissBubble,5000);}catch(RuntimeException e){bubble=null;lastError=e.toString();}
    }
    private void showDog(){
        if(dog!=null)return;
        dog=new PixelDogView(this);dogParams=params(dp(80),dp(80));
        dogParams.x=prefs.getInt("x",0);dogParams.y=prefs.getInt("y",dp(220));clampDog();
        dog.setOnClickListener(v->handleTaps(1));
        dog.setOnTouchListener(new View.OnTouchListener(){
            float x,y;int px,py;boolean moved,held;
            final Runnable hold=()->{held=true;taps.cancel();handler.removeCallbacks(finishTaps);open(CompanionActivity.class);};
            public boolean onTouch(View v,MotionEvent e){
                switch(e.getActionMasked()){
                    case MotionEvent.ACTION_DOWN:
                        if(dog instanceof PixelDogView)((PixelDogView)dog).touch();
                        handler.removeCallbacks(finishTaps);x=e.getRawX();y=e.getRawY();px=dogParams.x;py=dogParams.y;moved=false;held=false;
                        handler.postDelayed(hold,650);return true;
                    case MotionEvent.ACTION_MOVE:
                        if(Math.abs(e.getRawX()-x)+Math.abs(e.getRawY()-y)>ViewConfiguration.get(CompanionService.this).getScaledTouchSlop()){
                            moved=true;taps.cancel();handler.removeCallbacks(hold);
                        }
                        if(moved&&dog!=null){if(dog instanceof PixelDogView)((PixelDogView)dog).move();dogParams.x=px+(int)(e.getRawX()-x);dogParams.y=py+(int)(e.getRawY()-y);clampDog();windows.updateViewLayout(dog,dogParams);}
                        return true;
                    case MotionEvent.ACTION_UP:
                        handler.removeCallbacks(hold);
                        if(moved)prefs.edit().putInt("x",dogParams.x).putInt("y",dogParams.y).apply();
                        else if(!held){taps.tap();handler.postDelayed(finishTaps,400);}
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        handler.removeCallbacks(hold);handler.removeCallbacks(finishTaps);taps.cancel();return true;
                }return true;
            }
        });
        try{windows.addView(dog,dogParams);lastError="";}catch(RuntimeException e){lastError=e.toString();android.util.Log.e("PixelCompanion","Overlay creation failed",e);dog=null;}
    }
    private void clampDog(){
        android.util.DisplayMetrics m=getResources().getDisplayMetrics();
        dogParams.x=Math.max(0,Math.min(dogParams.x,m.widthPixels-dp(80)));
        dogParams.y=Math.max(dp(28),Math.min(dogParams.y,m.heightPixels-dp(120)));
    }
    private void showNudge(){
        hideBubble(); nudgeBubble=true; LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(16),dp(12),dp(16),dp(12));
        android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();bg.setColor(Color.rgb(255,245,222));bg.setCornerRadius(dp(16));card.setBackground(bg);
        TextView message=new TextView(this);message.setTextColor(Color.rgb(65,51,44));message.setTextSize(16);
        message.setText("One little step together?\n\n"+prefs.getString("task","")+"\n"+prefs.getString("detail","")+"\n\nWant to work on this first?");card.addView(message);
        action(card,"Open my tasks",()->navigate("today"));
        action(card,"Take a 5-minute break",()->{prefs.edit().putLong("snooze",System.currentTimeMillis()+5*60000).apply();hideAll();});
        action(card,"Continue anyway",()->hideBubble());
        WindowManager.LayoutParams p=params(Math.min(dp(300),getResources().getDisplayMetrics().widthPixels-dp(24)),WindowManager.LayoutParams.WRAP_CONTENT);
        p.x=dp(12);p.y=dp(64);bubble=card;
        try{windows.addView(bubble,p);handler.postDelayed(dismissBubble,20000);}catch(RuntimeException e){bubble=null;}
    }
    private void action(LinearLayout layout,String label,Runnable r){Button b=new Button(this);b.setText(label);b.setAllCaps(false);layout.addView(b);b.setOnClickListener(v->r.run());}
    private void hideBubble(){handler.removeCallbacks(dismissBubble);if(bubble!=null){try{windows.removeViewImmediate(bubble);}catch(RuntimeException ignored){}bubble=null;}}
    private void hideAll(){handler.removeCallbacks(finishTaps);taps.cancel();hideBubble();if(dog!=null){try{windows.removeViewImmediate(dog);}catch(RuntimeException ignored){}dog=null;}}
    @Override public void onDestroy(){running=false;handler.removeCallbacksAndMessages(null);hideAll();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
    @Override protected void dump(java.io.FileDescriptor fd,java.io.PrintWriter out,String[] args){
        out.println("PixelCompanion foreground="+foreground+" activity="+tracker.activity+" events="+eventCount+" dogAttached="+(dog!=null)+" gesture="+lastGesture+" lastError="+lastError);
    }
}
