package com.tasks.app;

import android.content.Context;
import android.graphics.*;
import java.io.IOException;
import java.util.*;

/** Original user-supplied sheets remain unmodified in assets. Only non-movement poses are used.
 * Clipping and blue-screen keying happen once at load; foreground pixels retain their source RGB.
 */
final class ReferencePetRenderer {
    private static final Map<String,Map<String,Bitmap>> CACHE=new HashMap<>();
    private final Paint paint=new Paint();
    private final Context context;
    ReferencePetRenderer(Context context){this.context=context;paint.setFilterBitmap(false);}
    private Map<String,Bitmap> load(String species){
        if(CACHE.containsKey(species))return CACHE.get(species);
        boolean cat=species.equals("calico");
        String[] states={"idle","pet","prepare","rest","sleep","wake"};
        int[][] boxes=cat?new int[][]{
            {200,65,325,205},{200,65,325,205},{190,590,325,748},
            {580,620,780,748},{810,610,995,748},{380,400,575,575}
        }:new int[][]{
            {170,45,330,195},{835,40,980,195},{135,585,305,748},
            {320,625,540,748},{790,610,1000,748},{355,395,535,565}
        };
        Map<String,Bitmap> frames=new HashMap<>();
        try(java.io.InputStream stream=context.getAssets().open("pets/"+species+"-reference.png")){
            BitmapFactory.Options options=new BitmapFactory.Options();options.inScaled=false;
            Bitmap sheet=BitmapFactory.decodeStream(stream,null,options);
            if(sheet==null)throw new IOException("Invalid sprite sheet");
            for(int i=0;i<states.length;i++)frames.put(states[i],cutout(sheet,boxes[i]));
            sheet.recycle();
        }catch(IOException e){throw new IllegalStateException("Cannot load companion artwork",e);}
        CACHE.put(species,frames);return frames;
    }
    private static Bitmap cutout(Bitmap source,int[] box){
        int w=box[2]-box[0],h=box[3]-box[1];int[] pixels=new int[w*h];
        source.getPixels(pixels,0,w,box[0],box[1],w,h);
        // Blue/slate background only. White fur, orange patches and neutral dark outlines survive.
        int left=w,top=h,right=0,bottom=0;
        for(int y=0;y<h;y++)for(int x=0;x<w;x++){
            int i=y*w+x,c=pixels[i],r=Color.red(c),g=Color.green(c),b=Color.blue(c);
            if(b-r>=7 && g-r>=3 && r<135 && g<150 && b<170){pixels[i]=Color.TRANSPARENT;continue;}
            left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);
        }
        // Keep the main connected sprite; discard any clipped sheet labels or isolated artifacts.
        int[] component=new int[pixels.length],queue=new int[pixels.length];int next=0,best=0,bestCount=0;
        for(int start=0;start<pixels.length;start++){
            if(pixels[start]==Color.TRANSPARENT||component[start]!=0)continue;
            int head=0,tail=0;queue[tail++]=start;component[start]=++next;
            while(head<tail){
                int point=queue[head++],px=point%w,py=point/w;
                for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
                    int nx=px+dx,ny=py+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;
                    int q=ny*w+nx;if(pixels[q]!=Color.TRANSPARENT&&component[q]==0){component[q]=next;queue[tail++]=q;}
                }
            }
            if(tail>bestCount){best=next;bestCount=tail;}
        }
        left=w;top=h;right=0;bottom=0;
        for(int y=0;y<h;y++)for(int x=0;x<w;x++){
            int i=y*w+x;if(component[i]!=best){pixels[i]=Color.TRANSPARENT;continue;}
            left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);
        }
        Bitmap full=Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888);
        if(right<=left||bottom<=top)return full;
        Bitmap trimmed=Bitmap.createBitmap(full,left,top,right-left,bottom-top);
        if(trimmed!=full)full.recycle();return trimmed;
    }
    void draw(Canvas canvas,int width,int height,String species,String state,long time){
        Bitmap frame=load(species).get(state);
        // Fixed source-pixel scale and shared baseline prevent pose-to-pose size jumps.
        float scale=Math.min(width/230f,height/190f);
        float w=frame.getWidth()*scale,h=frame.getHeight()*scale;
        float x=(width-w)/2, baseline=height*.92f;
        boolean asleep=state.equals("sleep"), petted=state.equals("pet");
        // Slow inhalation/exhalation changes height around the paws, never floats the pet.
        double phase=2*Math.PI*(time%(asleep?4600:3400))/(asleep?4600:3400);
        float breath=(float)(.5-.5*Math.cos(phase));
        float inhale=scale*breath*(asleep?1.6f:1.1f);
        float squash=petted?(float)Math.sin(time/180.0)*scale*1.3f:0;
        float renderedHeight=h+inhale-squash;
        float y=baseline-renderedHeight;
        // Two translucent, stepped bands keep a soft pixel-art contact shadow under the paws.
        paint.setColor(Color.argb(24,17,21,29));
        canvas.drawRect(x+w*.08f,baseline-scale,x+w*.92f,baseline+3*scale,paint);
        paint.setColor(Color.argb(30,17,21,29));
        canvas.drawRect(x+w*.19f,baseline,x+w*.81f,baseline+2*scale,paint);
        paint.setAlpha(255);
        canvas.drawBitmap(frame,null,new RectF(x,y,x+w,baseline),paint);
        if(petted){
            // Rising hearts have a fixed 1.2-second cycle; affection never moves the overlay.
            float p=Math.max(2,width/42f), rise=(time%1200)/1200f;
            for(int i=0;i<2;i++){
                float hx=width*(i==0?.22f:.72f),hy=Math.max(4*p,y+7*p)-rise*6*p-i*2*p;
                paint.setColor(Color.argb((int)(220*(1-rise*.7f)),226,86,116));
                canvas.drawRect(hx,hy,hx+2*p,hy+p,paint);canvas.drawRect(hx+3*p,hy,hx+5*p,hy+p,paint);
                canvas.drawRect(hx,hy+p,hx+5*p,hy+2*p,paint);canvas.drawRect(hx+p,hy+2*p,hx+4*p,hy+3*p,paint);canvas.drawRect(hx+2*p,hy+3*p,hx+3*p,hy+4*p,paint);
            }
        }else if(asleep){
            float p=Math.max(1,scale),rise=(time%3000)/3000f;
            float zx=Math.min(width-8*p,x+w*.78f),zy=Math.max(7*p,y-2*p)-rise*5*p;
            paint.setColor(Color.argb((int)(150*(1-rise)),213,220,231));
            canvas.drawRect(zx,zy,zx+5*p,zy+p,paint);
            for(int i=1;i<4;i++)canvas.drawRect(zx+(4-i)*p,zy+i*p,zx+(5-i)*p,zy+(i+1)*p,paint);
            canvas.drawRect(zx,zy+4*p,zx+5*p,zy+5*p,paint);
        }
        // Reset alpha before the next sprite draw (effects use translucent paint).
        paint.setAlpha(255);
    }
}
