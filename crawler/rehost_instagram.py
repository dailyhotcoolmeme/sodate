"""혼술바 인스타 프로필 사진 → R2 재호스팅 → places.profile_image (피드 아바타).

  .venv/bin/python rehost_instagram.py [limit]

- 대상: service=honsul, instagram 있고 profile_image 없는 곳(재개 가능).
- 방식(파일럿과 동일): 인스타 web_profile_info API 로 profile_pic_url_hd 취득.
  로그인 없이 되지만 IP 레이트리밋이 빡세다 → 느린 pace + 400/429 백오프.
- 로고 placeholder(static.cdninstagram/rsrc.php)는 거부(profile_image null 유지).
- 프로필 사진 → 320px WebP → R2 honsul/ig/{handle}.webp → profile_image·thumbnail_url.
"""
import io, os, re, sys, json, time, urllib.request
import httpx
from dotenv import load_dotenv
load_dotenv()
from PIL import Image
from utils.r2_client import upload_bytes, object_exists, PUBLIC_MEDIA_BASE

PROJECT = 'kmakdtcavtheaqobktlj'
PAT = open(os.path.expanduser('~/.config/sodate/supabase-pat-moit')).read().strip()
UA_API = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
IG_APP_ID = '936619743392459'


def run_sql(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query': sql}).encode(), method='POST',
        headers={'Authorization': f'Bearer {PAT}', 'Content-Type': 'application/json', 'User-Agent': UA_API})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def is_logo(url):
    return (not url) or 'rsrc.php' in url or 'static.cdninstagram' in url


def profile_pic(client, handle):
    """web_profile_info 로 프로필 사진 URL. 실패/차단이면 ('', code) 반환."""
    r = client.get('https://www.instagram.com/api/v1/users/web_profile_info/',
                   params={'username': handle},
                   headers={'X-IG-App-ID': IG_APP_ID, 'X-CSRFToken': client.cookies.get('csrftoken', ''),
                            'X-Requested-With': 'XMLHttpRequest', 'Referer': f'https://www.instagram.com/{handle}/'})
    if r.status_code != 200:
        return '', r.status_code
    u = r.json().get('data', {}).get('user') or {}
    pic = u.get('profile_pic_url_hd') or u.get('profile_pic_url') or ''
    return ('' if is_logo(pic) else pic), 200


def looks_blank(raw):
    """로고/차단 placeholder(거의 단색·흰바탕)면 True → 저장 안 함."""
    try:
        im = Image.open(io.BytesIO(raw)).convert('RGB').resize((16, 16))
        px = list(im.getdata())
        # 표준편차가 매우 낮으면 단색(로고/백지)
        r = [p[0] for p in px]; g = [p[1] for p in px]; b = [p[2] for p in px]
        def sd(v):
            m = sum(v) / len(v)
            return (sum((x - m) ** 2 for x in v) / len(v)) ** 0.5
        return sd(r) < 8 and sd(g) < 8 and sd(b) < 8
    except Exception:
        return True


def to_webp(raw, edge=320):
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    w, h = im.size
    s = edge / max(w, h)
    if s < 1:
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=82, method=6)
    return buf.getvalue()


def handle_of(url):
    m = re.search(r'instagram\.com/([A-Za-z0-9_.]+)', url or '')
    return m.group(1) if m else None


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    rows = run_sql("select id, instagram from places where service='honsul' "
                   "and instagram is not null and profile_image is null;")
    print(f'대상 {len(rows)}곳')
    updates, ok, logo, blocked = [], 0, 0, 0
    t0 = time.time()
    with httpx.Client(headers={'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9'},
                      timeout=15, follow_redirects=True) as c:
        c.get('https://www.instagram.com/')  # csrftoken
        for i, r in enumerate(rows[:limit], 1):
            h = handle_of(r['instagram'])
            if not h:
                continue
            key = f'honsul/ig/{h}.webp'
            try:
                if object_exists(key):
                    updates.append((r['id'], f'{PUBLIC_MEDIA_BASE}/media/{key}')); ok += 1
                else:
                    pic, code = profile_pic(c, h)
                    if code in (429, 400, 401):        # IP 레이트리밋/차단 → 길게 쉬고 재시도
                        blocked += 1
                        wait = 60
                        print(f'    {code} 차단 — {wait}s 대기 (#{blocked})')
                        _flush(updates); updates = []
                        time.sleep(wait)
                        c.get('https://www.instagram.com/')
                        continue
                    if not pic:                        # 로고/없음 → 스킵(와인잔 유지)
                        logo += 1
                    else:
                        raw = c.get(pic, headers={'User-Agent': UA}).content
                        if looks_blank(raw):        # 다운로드가 로고/백지면 스킵
                            logo += 1
                        else:
                            url = upload_bytes(key, to_webp(raw), 'image/webp')
                            updates.append((r['id'], url)); ok += 1
            except Exception as e:
                print(f'  {h}: 실패 {str(e)[:50]}')
            if i % 20 == 0:
                print(f'  … {i}/{min(limit, len(rows))} · 성공 {ok} 로고 {logo} 차단 {blocked} ({time.time()-t0:.0f}s)')
                _flush(updates); updates = []
            time.sleep(1.5)
    _flush(updates)
    print(f'완료 · 성공 {ok} · 로고스킵 {logo} · 차단 {blocked} · {time.time()-t0:.0f}s')


def _flush(updates):
    if not updates:
        return
    vals = ','.join("('%s'::uuid, '%s')" % (cid, url.replace("'", "''")) for cid, url in updates)
    run_sql(f"update places as p set profile_image = c.url, thumbnail_url = c.url "
            f"from (values {vals}) as c(id, url) where p.id = c.id;")


if __name__ == '__main__':
    main()
