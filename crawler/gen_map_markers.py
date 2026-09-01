import os, io, re, urllib.request
from PIL import Image, ImageDraw, ImageFilter
import boto3
from botocore.config import Config

def env(k):
    for line in open('.env'):
        if line.startswith(k+'='): return line.split('=',1)[1].strip()
    return None

SB_URL=env('SUPABASE_URL'); SB_KEY=env('SUPABASE_SERVICE_ROLE_KEY')
R2=boto3.client('s3', endpoint_url=env('R2_ENDPOINT'),
    aws_access_key_id=env('R2_ACCESS_KEY_ID'), aws_secret_access_key=env('R2_SECRET_ACCESS_KEY'),
    config=Config(signature_version='s3v4'), region_name='auto')
BUCKET=env('R2_BUCKET')

def places():
    import json
    off=0; out=[]
    while True:
        req=urllib.request.Request(f"{SB_URL}/rest/v1/places?profile_image=not.is.null&select=naver_place_id,profile_image&limit=1000&offset={off}",
            headers={'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY})
        b=json.load(urllib.request.urlopen(req))
        if not b: break
        out+=b; off+=len(b)
        if len(b)<1000: break
    return out

SS=3; SIZE=128; S=SIZE*SS
def make_marker(src_bytes):
    im=Image.open(io.BytesIO(src_bytes)).convert('RGBA')
    # cover crop 정사각
    w,h=im.size; m=min(w,h); im=im.crop(((w-m)//2,(h-m)//2,(w-m)//2+m,(h-m)//2+m))
    inner=S-int(S*0.11)  # 링 두께
    im=im.resize((inner,inner), Image.LANCZOS)
    canvas=Image.new('RGBA',(S,S),(0,0,0,0))
    # 그림자
    sh=Image.new('RGBA',(S,S),(0,0,0,0)); ImageDraw.Draw(sh).ellipse([int(S*0.06),int(S*0.09),S-int(S*0.06),S-int(S*0.03)],fill=(0,0,0,90))
    sh=sh.filter(ImageFilter.GaussianBlur(S*0.02)); canvas.alpha_composite(sh)
    # 흰 링
    ImageDraw.Draw(canvas).ellipse([0,0,S-1,S-1],fill=(255,255,255,255))
    # 사진 원형
    mask=Image.new('L',(inner,inner),0); ImageDraw.Draw(mask).ellipse([0,0,inner-1,inner-1],fill=255)
    off=(S-inner)//2; canvas.paste(im,(off,off),mask)
    out=canvas.resize((SIZE,SIZE),Image.LANCZOS)
    b=io.BytesIO(); out.save(b,'PNG'); return b.getvalue()

ps=places(); print(f"대상 {len(ps)}곳")
ok=0; fail=0
for i,p in enumerate(ps):
    pid=p.get('naver_place_id'); url=p.get('profile_image')
    if not pid or not url: fail+=1; continue
    try:
        raw=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=20).read()
        png=make_marker(raw)
        key=f"honsul/marker/{pid}.png"
        R2.put_object(Bucket=BUCKET,Key=key,Body=png,ContentType='image/png',CacheControl='public,max-age=604800')
        ok+=1
    except Exception as e:
        fail+=1
        if fail<=5: print('ERR',pid,e)
    if (i+1)%50==0: print(f"  {i+1}/{len(ps)} (ok {ok})")
print(f"완료: ok {ok}, fail {fail}")
