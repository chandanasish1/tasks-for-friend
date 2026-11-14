package com.tasks.app;

import android.content.Context;
import android.graphics.*;
import android.os.SystemClock;
import android.view.View;

/** Original pixel artwork: ivory spaniel, ink ears and a cherry collar. */
public class PixelDogView extends View {
    private final Paint paint=new Paint();
    private static long lastTouch=SystemClock.uptimeMillis(), wakeUntil, happyUntil;
    private static final int INK=Color.rgb(29,34,49), EAR=Color.rgb(54,65,87), LIGHT=Color.rgb(250,248,239), SHADE=Color.rgb(192,202,214), RED=Color.rgb(217,57,85), PINK=Color.rgb(244,139,157);
    public PixelDogView(Context context){
        super(context);setContentDescription("Pixel spaniel. Tap to pet, double tap for Today, triple tap for Focus. Drag to move; hold for settings.");
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);setFocusable(true);setClickable(true);
    }
    public void touch(){
        long now=SystemClock.uptimeMillis();
        if(now-lastTouch>=45000)wakeUntil=now+1400;
        lastTouch=now;invalidate();
    }
    public void pet(){touch();happyUntil=Math.max(SystemClock.uptimeMillis(),wakeUntil)+3500;invalidate();}
    private void rect(Canvas c,int color,float x,float y,float w,float h){paint.setColor(color);c.drawRect(x,y,x+w,y+h,paint);}
    private void shape(Canvas c,int color,float... xy){paint.setColor(color);Path p=new Path();p.moveTo(xy[0],xy[1]);for(int i=2;i<xy.length;i+=2)p.lineTo(xy[i],xy[i+1]);p.close();c.drawPath(p,paint);}
    private void heart(Canvas c,int x,int y){rect(c,RED,x,y,2,1);rect(c,RED,x+3,y,2,1);rect(c,RED,x,y+1,5,1);rect(c,RED,x+1,y+2,3,1);rect(c,RED,x+2,y+3,1,1);}
    @Override protected void onDraw(Canvas c){
        super.onDraw(c);
        long now=SystemClock.uptimeMillis(),idle=now-lastTouch;
        String mood=DogMood.at(idle);
        boolean waking=now<wakeUntil,happy=now<happyUntil&&!waking;
        float settle=mood.equals("sleep")?1:mood.equals("settle")?(idle-45000)/5000f:0;
        if(waking)settle=Math.max(0,(wakeUntil-now)/1400f);
        int frame=(int)(now/(happy?100:240));
        c.save();float scale=Math.min(getWidth()/40f,getHeight()/36f);c.translate((getWidth()-40*scale)/2,(getHeight()-36*scale)/2);c.scale(scale,scale);
        // A small cool shadow anchors the sprite; the silhouette stays pixel aligned.
        rect(c,Color.argb(45,22,28,44),8,32,26,2);rect(c,Color.argb(30,22,28,44),5,33,31,1);
        if(settle>.78f){
            int breathe=(now/1600)%2==0?0:1;
            shape(c,INK,12,25,16,22,29,22,34,25,35,29,32,32,12,32);
            shape(c,LIGHT,14,26,18,24+breathe,28,24+breathe,32,26,32,30,14,30);
            rect(c,SHADE,23,28,9,2);rect(c,EAR,28,24,3,4);
            // Curled tail and paws; chin rests on the front paws.
            shape(c,INK,30,27,36,27,37,29,36,32,29,32,29,30,34,30,34,29,30,29);
            rect(c,LIGHT,10,30,10,2);rect(c,SHADE,12,31,2,1);
            shape(c,INK,6,23,9,21,17,21,21,24,21,29,18,31,7,31,4,28,4,25);
            shape(c,LIGHT,8,23,16,23,19,25,19,28,16,29,8,29,6,27);
            shape(c,EAR,6,22,9,22,10,26,8,30,5,29,4,26);
            rect(c,INK,12,26,4,1);rect(c,INK,18,27,2,1);rect(c,RED,20,28,2,2);
            if(mood.equals("sleep")){
                int zy=(int)(now/700%3);int zx=27;
                rect(c,SHADE,zx,13-zy,5,1);rect(c,SHADE,zx+3,14-zy,1,1);rect(c,SHADE,zx+2,15-zy,1,1);rect(c,SHADE,zx+1,16-zy,1,1);rect(c,SHADE,zx,17-zy,5,1);
            }
        }else{
            int down=Math.round(settle*8),bounce=happy?(frame%4<2?-1:0):0;
            c.save();c.translate(0,bounce);
            // Tail wags independently, with a faster sweep when petted.
            int wag=happy?(frame%3-1)*2:(frame%8<4?0:1);
            shape(c,INK,27,25,31,25,32,23+wag,34,23+wag,34,28,31,30,27,30);
            rect(c,LIGHT,29,26,3,2);rect(c,LIGHT,32,24+wag,1,3);
            shape(c,INK,15,20+down,25,20+down,28,25+down/2,28,31,12,31,12,26);
            shape(c,LIGHT,16,22+down,23,22+down,25,26+down/2,25,29,14,29,14,26);
            rect(c,SHADE,23,25+down/2,2,4-down/2);rect(c,EAR,24,23+down/2,2,3);
            rect(c,INK,11,30,8,3);rect(c,INK,21,30,8,3);rect(c,LIGHT,12,30,6,2);rect(c,LIGHT,22,30,6,2);
            rect(c,SHADE,15,31,1,1);rect(c,SHADE,25,31,1,1);
            // Head tilt is a stepped pixel displacement, not a rotation of the whole sprite.
            int tilt=idle%14000<1800&&!happy?1:0;
            c.save();c.translate(tilt,down);
            shape(c,INK,10,9,14,6,23,6,27,9,28,16,25,21,13,21,9,17);
            shape(c,LIGHT,12,10,15,8,22,8,25,10,26,15,23,19,14,19,11,16);
            rect(c,SHADE,13,18,11,2);rect(c,LIGHT,15,17,8,3);
            shape(c,INK,9,8,12,8,13,13,12,21,9,23,6,21,6,14,7,10);
            shape(c,EAR,8,11,10,10,11,14,10,20,8,21,7,19,7,14);
            shape(c,INK,24,8,27,8,30,12,30,20,28,23,25,21,24,15);
            shape(c,EAR,26,10,28,12,29,16,28,20,27,21,26,18);
            boolean closed=happy||mood.equals("yawn")||now%5500<180||waking;
            if(closed){rect(c,INK,14,13,3,1);rect(c,INK,21,13,3,1);}
            else {rect(c,INK,15,12,2,3);rect(c,INK,21,12,2,3);rect(c,LIGHT,15,12,1,1);rect(c,LIGHT,21,12,1,1);}
            rect(c,INK,17,16,4,2);rect(c,INK,18,18,2,1);
            if(mood.equals("yawn")){rect(c,INK,17,18,4,3);rect(c,PINK,18,20,2,1);}
            else if(happy){rect(c,PINK,18,19,2,2);}
            rect(c,RED,13,21,12,2);rect(c,Color.rgb(255,213,114),18,23,2,2);
            c.restore();c.restore();
            if(happy){heart(c,4,3-frame%3);heart(c,29,5-frame%3);}
        }
        c.restore();postInvalidateDelayed(happy||waking||mood.equals("settle")?100:mood.equals("sleep")?500:180);
    }
    @Override public boolean performClick(){super.performClick();return true;}
}
