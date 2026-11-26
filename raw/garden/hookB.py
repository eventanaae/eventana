import numpy as np,cv2,subprocess
from PIL import Image
W,H,FPS=1080,1920,30
cap=cv2.VideoCapture('video3.mp4');fr=[]
while True:
    ok,im=cap.read()
    if not ok:break
    fr.append(im)
F=cv2.imread('/home/user/garden/aft/F_aft.png').astype(np.float32)/255
T=np.asarray(Image.open('/home/user/garden/vid/tB.png').convert('RGBA')).astype(np.float32)/255
T=T[...,[2,1,0,3]]
def zoom(img,s,cx=540,cy=900):
    M=np.float32([[s,0,cx-s*cx],[0,s,cy-s*cy]]);return cv2.warpAffine(img,M,(W,H),borderMode=cv2.BORDER_REFLECT)
out=[]
for i in range(int(0.8*FPS)):          # cold open on the finished party
    t=i/FPS; f=zoom(F,1.08-0.04*t)
    a=T[...,3:4]*min(1,(t+0.05)/0.1); f=f*(1-a)+T[...,:3]*a
    out.append((np.clip(f,0,1)*255).astype(np.uint8))
# rewind: build frames (1.2s..4.4s) played backwards fast, with blur + desaturate
seg=fr[int(1.2*FPS):int(4.4*FPS)][::-1][::8]
for k,im in enumerate(seg):
    b=cv2.GaussianBlur(im,(0,0),2.5); g=cv2.cvtColor(cv2.cvtColor(b,cv2.COLOR_BGR2GRAY),cv2.COLOR_GRAY2BGR)
    b=cv2.addWeighted(b,0.6,g,0.4,0); b=cv2.addWeighted(b,0.85,np.full_like(b,255),0.15,0)
    out.append(b)
for im in fr[int(1.2*FPS):]: out.append(im)
p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-c:v','libx264','-crf','17','-pix_fmt','yuv420p','videoB.mp4'],stdin=subprocess.PIPE)
for o in out: p.stdin.write(o.tobytes())
p.stdin.close();p.wait();print(len(out)/FPS, len(seg))
