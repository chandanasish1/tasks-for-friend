package com.tasks.app;

import android.content.Context;
import android.graphics.*;
import android.view.View;

/** Original, code-drawn pixel sprite; nearest-neighbour rectangles, no image service. */
public class PixelDogView extends View {
    private final Paint paint = new Paint();
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
        super(context); setContentDescription("Pixel dog. Double tap to open Tasks. Drag to move. Long press for companion settings.");
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        setFocusable(true); setClickable(true);
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long tick = android.os.SystemClock.uptimeMillis() / 350;
        float pixel = Math.min(getWidth(), getHeight()) / 26f;
        canvas.save(); canvas.translate(pixel, pixel + (tick % 8 == 0 ? pixel : 0));
        for (int y = 0; y < DOG.length; y++) for (int x = 0; x < DOG[y].length(); x++) {
            char c = DOG[y].charAt(x); if(c == '.') continue;
            int color = switch(c) {
                case 'O' -> Color.rgb(69, 47, 43); case 'B' -> Color.rgb(139, 91, 64);
                case 'C' -> Color.rgb(226, 175, 113); case 'W' -> Color.rgb(255, 237, 202);
                case 'R' -> Color.rgb(124, 164, 144); default -> Color.rgb(45, 35, 34);
            };
            paint.setColor(color);
            float dy = x > 18 && tick % 2 == 0 ? -1 : 0;
            if (c == 'K' && y == 7 && tick % 15 == 0) {
                canvas.drawRect(x*pixel, (y+dy+.65f)*pixel, (x+1)*pixel, (y+dy+1)*pixel, paint);
            } else canvas.drawRect(x*pixel, (y+dy)*pixel, (x+1)*pixel, (y+dy+1)*pixel, paint);
        }
        canvas.restore(); postInvalidateDelayed(350);
    }
    @Override public boolean performClick() { super.performClick(); return true; }
}
