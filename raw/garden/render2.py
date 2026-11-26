import numpy as np, cv2, subprocess, sys
from PIL import Image
V='/home/user/garden/vid/'; W,H,FPS=1080,1920,30
def L(f,mode='RGB'): return np.asarray(Image.open(V+f).convert(mode)).astype(np.float32)/255
E=L('E.png');F=L('F.png');MS=L('m_stand.png','L')[...,None];MT=L('m_tables.png','L')[...,None]
D=[L(f'd{i}.png') for i in range(1,7)]
T={k:L(f'{k}.png','RGBA') for k in ['t1','t2','t3','t4','t5','logo','cta']}
def clip(f,start,n):
    cap=cv2.VideoCapture(V+f);fr=[]
    while True:
        ok,im=cap.read()
        if not ok:break
        fr.append(cv2.resize(cv2.cvtColor(im,cv2.COLOR_BGR2RGB),(W,H)).astype(np.float32)/255)
    out=[fr[min(len(fr)-1,int((start+i/FPS)*24))] for i in range(n)]
    return out
def warm(x,k=1.0):
    y=x.copy();y[...,0]*=1+0.06*k;y[...,2]*=1-0.07*k
    y=np.clip((y-0.5)*1.06+0.5+0.01,0,1);return y
def zoom(img,s,cx=540,cy=960):
    M=np.float32([[s,0,cx-s*cx],[0,s,cy-s*cy]])
    return cv2.warpAffine(img,M,(W,H),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
def over(base,t,a=1.0):
    al=t[...,3:4]*a;return base*(1-al)+t[...,:3]*al
def ease(x): x=min(max(x,0),1);return x*x*(3-2*x)
def pop(x):
    x=min(max(x,0),1);return 0.9+0.13*np.sin(x*np.pi*0.5)*(1) - 0.03*x  # 0.9 -> 1.0 with slight overshoot
def tfade(t,a,b,f=0.25): return ease((t-a)/f)*ease((b-t)/f)
CK=clip('castle_v2.mp4',0.4,int(3.5*FPS)); BK=clip('bubble_v3.mp4',0.4,int(3.5*FPS))
TOT=22.4; N=int(TOT*FPS)
p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
  '-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','/home/user/garden/build/video2.mp4'],stdin=subprocess.PIPE)
for i in range(N):
    t=i/FPS
    if t<1.4:
        fr=zoom(E,1.0+0.03*t/1.4); fr=over(fr,T['t1'],min(1,(t+0.05)/0.1)*ease((1.55-t)/0.2))
    elif t<5.6:
        u=t-1.4
        a1=ease((u-0.15)/0.45); s1=pop((u-0.15)/0.6)
        Fs=zoom(F,s1,540,800); Ms=zoom(MS,s1,540,800)
        if Ms.ndim==2: Ms=Ms[...,None]
        fr=E*(1-a1*Ms)+Fs*a1*Ms
        a2=ease((u-1.0)/0.45); s2=pop((u-1.0)/0.6)
        Ft=zoom(F,s2,450,1400); Mt=zoom(MT,s2,450,1400)
        if Mt.ndim==2: Mt=Mt[...,None]
        fr=fr*(1-a2*Mt)+Ft*a2*Mt
        a3=ease((u-1.8)/0.6); fr=fr*(1-a3)+F*a3
        fr=zoom(fr,1.0+0.04*u/4.2)
        fl=max(0,1-u/0.18); fr=fr*(1-fl)+fl
        fr=over(fr,T['t2'],tfade(t,1.6,5.4,0.25))
    elif t<6.2:
        u=(t-5.6)/0.6; d=1-0.85*np.sin(u*np.pi); fr=zoom(F,1.04)*d
    elif t<9.0:
        u=(t-6.2)/2.8; fr=warm(zoom(F,1.04+0.12*ease(u),540,760),0.6)
        fr=fr*ease((t-6.2)/0.2)
    elif t<13.2:
        k=min(5,int((t-9.0)/0.7)); u=((t-9.0)-k*0.7)/0.7
        P=[(1.75,430,880),(1.55,470,800),(1.12,540,900),(1.12,540,960),(1.45,640,1050),(1.22,540,1100)]
        zs,cx,cy=P[k]; fr=zoom(D[k],zs-0.06*u,cx,cy)
        fr=over(fr,T['t3'],tfade(t,9.2,13.0,0.25))
    elif t<16.7:
        fr=CK[min(len(CK)-1,int((t-13.2)*FPS))]
    elif t<20.2:
        fr=BK[min(len(BK)-1,int((t-16.7)*FPS))]; fr=over(fr,T['t4'],tfade(t,16.9,20.0,0.25))
    else:
        u=t-20.2; fr=warm(zoom(F,1.10-0.02*u,540,860),0.5)
        fr=over(fr,T['logo'],ease(u/0.4)); fr=over(fr,T['t5'],ease((u-0.2)/0.4)); fr=over(fr,T['cta'],ease((u-0.5)/0.4))
    if 13.9<=t<14.05 or 16.9<=t<17.05: pass
    p.stdin.write((np.clip(fr,0,1)*255).astype(np.uint8).tobytes())
p.stdin.close();p.wait();print('ok')
