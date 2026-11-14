package com.tasks.app;

import android.content.Context;
import android.graphics.*;
import android.view.View;

/** Original, code-drawn pixel sprite; nearest-neighbour rectangles, no image service. */
public class PixelDogView extends View {
    private final Paint paint = new Paint();
    private long happyUntil;
    public void pet(){happyUntil=android.os.SystemClock.uptimeMillis()+4000;invalidate();}
    private static final String[] DOG = {
        "........................", "........................",
        "....OOO........OOO......", "...OBBBOOOOOOOOBBBO.....",
        "...OBBOCCCCCCCCOBBO.....", "...OBBOCCCCCCCCOBBO.....",
        "...OBBOCCCCCCCCOBBO.....", "....OOCCKCCCCKCCOO......",
        ".....OCCCCCCCCCCO.......", ".....OCCWWWWWWCCO.......",
        ".....OCWWWKKWWWCO.......", "......OWWWWWWWWO........",
        ".......OOORROOO.........", "......OCCCROCCCO........",
        "......OCCCCCCCCO....OO..", "......OCCCCCCCCO...OCO..",
        "......OCCWCCWCCOOOOCCO..", "......OCCWCCWCCCCCCCO...",
        "......OCCWCCWCCCCCCO....", "......OCCWCCWCCCCCO.....",
        "......OWWWOOWWWOOO......", ".......OOO..OOO.........",
        "........................", "........................"
    };
    public PixelDogView(Context context) {
        super(context); setContentDescription("Pixel dog. Tap to pet. Double tap for Today. Triple tap for Focus. Drag to move. Hold for settings.");
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        setFocusable(true); setClickable(true);
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long time=android.os.SystemClock.uptimeMillis();
        boolean happy=time<happyUntil;
        long tick = time / (happy?90:180);
        float pixel = Math.min(getWidth(), getHeight()) / 30f;
        boolean curious=!happy && time%12000<2200;
        canvas.save(); canvas.translate(pixel*3, pixel*5-(happy?(tick%4<2?2:0):tick%12==0?1:0)*pixel);
        if(curious)canvas.rotate(tick%12<6?-6:6,12*pixel,15*pixel);
        for (int y = 0; y < DOG.length; y++) for (int x = 0; x < DOG[y].length(); x++) {
            char c = DOG[y].charAt(x); if(c == '.') continue;
            int color = switch(c) {
                case 'O' -> Color.rgb(69, 47, 43); case 'B' -> Color.rgb(139, 91, 64);
                case 'C' -> Color.rgb(226, 175, 113); case 'W' -> Color.rgb(255, 237, 202);
                case 'R' -> Color.rgb(124, 164, 144); default -> Color.rgb(45, 35, 34);
            };
            paint.setColor(color);
            float dy = x > 18 ? (tick%4<2?-2:1) : 0;
            if (c == 'K' && y == 7 && (happy || tick % 25 == 0)) {
                canvas.drawRect(x*pixel, (y+dy+.65f)*pixel, (x+1)*pixel, (y+dy+1)*pixel, paint);
            } else canvas.drawRect(x*pixel, (y+dy)*pixel, (x+1)*pixel, (y+dy+1)*pixel, paint);
        }
        if(happy){
            paint.setColor(Color.rgb(230,116,130));
            canvas.drawRect(11*pixel,11*pixel,13*pixel,13*pixel,paint);
            for(int i=0;i<3;i++){
                float hx=(3+i*7)*pixel,hy=(-2-(tick+i*2)%5)*pixel;
                canvas.drawRect(hx,hy,hx+2*pixel,hy+pixel,paint);
                canvas.drawRect(hx+3*pixel,hy,hx+5*pixel,hy+pixel,paint);
                canvas.drawRect(hx,hy+pixel,hx+5*pixel,hy+2*pixel,paint);
                canvas.drawRect(hx+pixel,hy+2*pixel,hx+4*pixel,hy+3*pixel,paint);
                canvas.drawRect(hx+2*pixel,hy+3*pixel,hx+3*pixel,hy+4*pixel,paint);
            }
        }
        canvas.restore(); postInvalidateDelayed(happy?90:180);
    }
    @Override public boolean performClick() { super.performClick(); return true; }
}
