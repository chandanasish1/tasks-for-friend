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
    private long lastQuery, lastNudge;
    private final Runnable dismissBubble=()->hideBubble();
    private final Runnable poll=new Runnable(){public void run(){
        if(!Settings.canDrawOverlays(CompanionService.this)||!CompanionActivity.usageAllowed(CompanionService.this)) {stopSelf();return;}
        PowerManager power=(PowerManager)getSystemService(POWER_SERVICE);
        KeyguardManager lock=(KeyguardManager)getSystemService(KEYGUARD_SERVICE);
        if(!power.isInteractive()||lock.isKeyguardLocked()){ hideAll(); foreground=""; lastQuery=0;handler.postDelayed(this,1000);return; }
        long now=System.currentTimeMillis();
        try {
            UsageStatsManager usage=(UsageStatsManager)getSystemService(USAGE_STATS_SERVICE);
            UsageEvents events=usage.queryEvents(lastQuery==0?now-10000:lastQuery,now);
            lastQuery=now;
            if(events==null){foreground="";} else {
                UsageEvents.Event e=new UsageEvents.Event();
                while(events.hasNextEvent()) {
                    events.getNextEvent(e);
                    if(e.getEventType()==UsageEvents.Event.ACTIVITY_RESUMED)foreground=e.getPackageName();
                    else if((e.getEventType()==UsageEvents.Event.ACTIVITY_PAUSED||e.getEventType()==UsageEvents.Event.ACTIVITY_STOPPED)
                        && e.getPackageName().equals(foreground)) foreground="";
                }
            }
            int mode=prefs.getInt("app:"+foreground,0);
            if(!CompanionPolicy.visible(foreground,mode,true,prefs.getLong("snooze",0),now))hideAll();
            else {
                showDog();
                if(CompanionPolicy.nudge(mode,prefs.getLong("focusUntil",0),lastNudge,
                    prefs.getLong("taskUntil",0),prefs.getString("task",""),now)) {
                    showNudge();lastNudge=now;
                }
                if(mode!=2 || prefs.getLong("focusUntil",0)<=now || prefs.getString("task","").isEmpty())hideBubble();
            }
        } catch(RuntimeException e){foreground="";hideAll();}
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
            .setContentTitle("Your pixel dog is nearby").setContentText("Only visible in chosen apps. Tap for controls.")
            .setContentIntent(settings).setOngoing(true).addAction(new Notification.Action.Builder(null,"Stop dog",stop).build()).build();
        startForeground(4701,n);running=true;handler.removeCallbacks(poll);handler.post(poll);return START_NOT_STICKY;
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private WindowManager.LayoutParams params(int width,int height){
        WindowManager.LayoutParams p=new WindowManager.LayoutParams(width,height,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT);
        p.gravity=Gravity.TOP|Gravity.LEFT;return p;
    }
    private void open(Class<?> activity){hideAll(); startActivity(new Intent(this,activity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP));}
    private void showDog(){
        if(dog!=null)return;
        dog=new PixelDogView(this);dogParams=params(dp(80),dp(80));
        dogParams.x=prefs.getInt("x",0);dogParams.y=prefs.getInt("y",dp(220));clampDog();
        GestureDetector gestures=new GestureDetector(this,new GestureDetector.SimpleOnGestureListener(){
            public boolean onDown(MotionEvent e){return true;}
            public boolean onDoubleTap(MotionEvent e){open(MainActivity.class);return true;}
            public void onLongPress(MotionEvent e){open(CompanionActivity.class);}
        });
        dog.setOnClickListener(v->open(MainActivity.class));
        dog.setOnTouchListener(new View.OnTouchListener(){float x,y;int px,py;boolean moved;
            public boolean onTouch(View v,MotionEvent e){
                gestures.onTouchEvent(e);
                if(e.getAction()==MotionEvent.ACTION_DOWN){x=e.getRawX();y=e.getRawY();px=dogParams.x;py=dogParams.y;moved=false;}
                if(e.getAction()==MotionEvent.ACTION_MOVE&&dog!=null){
                    if(Math.abs(e.getRawX()-x)+Math.abs(e.getRawY()-y)>dp(8))moved=true;
                    if(moved){dogParams.x=px+(int)(e.getRawX()-x);dogParams.y=py+(int)(e.getRawY()-y);clampDog();windows.updateViewLayout(dog,dogParams);}
                }
                if(e.getAction()==MotionEvent.ACTION_UP&&moved)prefs.edit().putInt("x",dogParams.x).putInt("y",dogParams.y).apply();
                return true;
            }
        });
        try{windows.addView(dog,dogParams);}catch(RuntimeException e){dog=null;}
    }
    private void clampDog(){
        android.util.DisplayMetrics m=getResources().getDisplayMetrics();
        dogParams.x=Math.max(0,Math.min(dogParams.x,m.widthPixels-dp(80)));
        dogParams.y=Math.max(dp(28),Math.min(dogParams.y,m.heightPixels-dp(120)));
    }
    private void showNudge(){
        hideBubble(); LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(16),dp(12),dp(16),dp(12));
        android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();bg.setColor(Color.rgb(255,245,222));bg.setCornerRadius(dp(16));card.setBackground(bg);
        TextView message=new TextView(this);message.setTextColor(Color.rgb(65,51,44));message.setTextSize(16);
        message.setText("One little step together?\n\n"+prefs.getString("task","")+"\n"+prefs.getString("detail","")+"\n\nWant to work on this first?");card.addView(message);
        action(card,"Open my tasks",()->open(MainActivity.class));
        action(card,"Take a 5-minute break",()->{prefs.edit().putLong("snooze",System.currentTimeMillis()+5*60000).apply();hideAll();});
        action(card,"Continue anyway",()->hideBubble());
        WindowManager.LayoutParams p=params(Math.min(dp(300),getResources().getDisplayMetrics().widthPixels-dp(24)),WindowManager.LayoutParams.WRAP_CONTENT);
        p.x=dp(12);p.y=dp(64);bubble=card;
        try{windows.addView(bubble,p);handler.postDelayed(dismissBubble,20000);}catch(RuntimeException e){bubble=null;}
    }
    private void action(LinearLayout layout,String label,Runnable r){Button b=new Button(this);b.setText(label);b.setAllCaps(false);layout.addView(b);b.setOnClickListener(v->r.run());}
    private void hideBubble(){handler.removeCallbacks(dismissBubble);if(bubble!=null){try{windows.removeViewImmediate(bubble);}catch(RuntimeException ignored){}bubble=null;}}
    private void hideAll(){hideBubble();if(dog!=null){try{windows.removeViewImmediate(dog);}catch(RuntimeException ignored){}dog=null;}}
    @Override public void onDestroy(){running=false;handler.removeCallbacksAndMessages(null);hideAll();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}
