import numpy as np, cv2, subprocess
from PIL import Image
V='/home/user/garden/vid/'; AF='/home/user/garden/aft/'; W,H,FPS=1080,1920,30
def L(f,mode='RGB'): return np.asarray(Image.open(f).convert(mode)).astype(np.float32)/255
E=L(AF+'E_aft_al.png');F=L(AF+'F_nm.png');MS=L(V+'m_stand.png','L')[...,None];MT=L(V+'m_tables.png','L')[...,None]
D=[L(AF+f+'_1080.png') for f in ['n_table','n_stand','n5','n6']]
T={k:L(V+f'{k}.png','RGBA') for k in ['t1','t2','t3','t4','t5','logo','cta']}
CL=[L(V+f'clk/{i:02d}.png','RGBA') for i in range(22)]
def clip(f,start,n):
    cap=cv2.VideoCapture(f);fr=[]
    while True:
        ok,im=cap.read()
        if not ok:break
        fr.append(cv2.resize(cv2.cvtColor(im,cv2.COLOR_BGR2RGB),(W,H)).astype(np.float32)/255)
    return [fr[min(len(fr)-1,int((start+i/FPS)*24))] for i in range(n)]
def warm(x,k=1.0):
    y=x.copy();y[...,0]*=1+0.04*k;y[...,2]*=1-0.04*k
    return np.clip((y-0.5)*1.05+0.5,0,1)
def zoom(img,s,cx=540,cy=960):
    M=np.float32([[s,0,cx-s*cx],[0,s,cy-s*cy]])
    r=cv2.warpAffine(img,M,(W,H),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
    return r if r.ndim==3 else r[...,None]
def over(base,t,a=1.0):
    al=t[...,3:4]*a;return base*(1-al)+t[...,:3]*al
def ease(x): x=min(max(x,0),1);return x*x*(3-2*x)
def pop(x): x=min(max(x,0),1);return 0.9+0.13*np.sin(x*np.pi*0.5)-0.03*x
def tfade(t,a,b,f=0.25): return ease((t-a)/f)*ease((b-t)/f)
CK=clip(V+'castle_aft.mp4',0.3,int(3.5*FPS)); BK=clip(V+'bubble_aft.mp4',0.3,int(3.5*FPS))
DET=[(0,1.10,540,1000),(1,1.10,540,900),(2,1.10,540,800),(3,1.10,540,1000)]
TOT=19.8; N=int(TOT*FPS)
p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
  '-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','/home/user/garden/build/video_paid.mp4'],stdin=subprocess.PIPE)
for i in range(N):
    t=i/FPS
    if t<1.2:
        fr=zoom(E,1.0+0.03*t/1.2); fr=over(fr,T['t1'],min(1,(t+0.05)/0.1)*ease((1.35-t)/0.2))
        fr=over(fr,CL[0])
    elif t<5.0:
        u=t-1.2
        a1=ease((u-0.15)/0.45); s1=pop((u-0.15)/0.6)
        Fs=zoom(F,s1,540,800); Ms=zoom(MS,s1,540,800)
        fr=E*(1-a1*Ms)+Fs*a1*Ms
        a2=ease((u-1.0)/0.45); s2=pop((u-1.0)/0.6)
        Ft=zoom(F,s2,450,1400); Mt=zoom(MT,s2,450,1400)
        fr=fr*(1-a2*Mt)+Ft*a2*Mt
        a3=ease((u-1.8)/0.6); fr=fr*(1-a3)+F*a3
        fr=zoom(fr,1.0+0.04*u/3.8)
        fl=max(0,1-u/0.18); fr=fr*(1-fl)+fl
        fr=over(fr,T['t2'],tfade(t,1.4,4.8,0.25))
        k=min(21,int(21*min(1,u/3.2))); fr=over(fr,CL[k],ease((4.9-t)/0.2))
    elif t<5.5:
        u=(t-5.0)/0.5; d=1-0.85*np.sin(u*np.pi); fr=zoom(F,1.04)*d
    elif t<8.0:
        u=(t-5.5)/2.5; fr=warm(zoom(F,1.04+0.12*ease(u),540,760),0.4)
        fr=fr*ease((t-5.5)/0.2)
    elif t<11.5:
        fr=CK[min(len(CK)-1,int((t-8.0)*FPS))]
    elif t<13.9:
        k=min(3,int((t-11.5)/0.6)); u=((t-11.5)-k*0.6)/0.6
        j,zs,cx,cy=DET[k]; fr=zoom(D[j],zs-0.06*u,cx,cy)
        fr=over(fr,T['t3'],tfade(t,11.6,13.8,0.2))
    elif t<17.4:
        fr=BK[min(len(BK)-1,int((t-13.9)*FPS))]; fr=over(fr,T['t4'],tfade(t,14.1,17.3,0.25))
    else:
        u=t-17.4; fr=warm(zoom(F,1.10-0.02*u,540,860),0.3)
        fr=over(fr,T['logo'],ease(u/0.4)); fr=over(fr,T['t5'],ease((u-0.2)/0.4)); fr=over(fr,T['cta'],ease((u-0.5)/0.4))
    p.stdin.write((np.clip(fr,0,1)*255).astype(np.uint8).tobytes())
p.stdin.close();p.wait();print('ok')
