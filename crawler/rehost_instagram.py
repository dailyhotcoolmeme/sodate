"""혼술바 인스타 프로필 사진 → R2 재호스팅 → places.profile_image (피드 아바타).

  .venv/bin/python rehost_instagram.py [limit]

- 대상: service=honsul, instagram 있고 profile_image 없는 곳(재개 가능).
- 프로필 URL의 og:image = 프로필 사진(facebookexternalhit UA로 로그인 없이 취득).
- 320px WebP 로 줄여 R2 키 honsul/ig/{handle}.webp 업로드 → 공개 URL 저장.
"""
import io, os, re, sys, json, time, urllib.request
import httpx
from dotenv import load_dotenv
load_dotenv()
from PIL import Image
from utils.r2_client import upload_bytes, object_exists, PUBLIC_MEDIA_BASE

PROJECT = 'xgcldcnqfqcugkcifyae'
PAT = open(os.path.expanduser('~/.config/sodate/supabase-pat')).read().strip()
UA_API = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
FB_UA = 'facebookexternalhit/1.1'
IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'


def run_sql(sql):
    body = json.dumps({'query': sql}).encode()
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=body, method='POST',
        headers={'Authorization': f'Bearer {PAT}', 'Content-Type': 'application/json', 'User-Agent': UA_API})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def og_image(handle):
    r = httpx.get(f'https://www.instagram.com/{handle}/',
                  headers={'User-Agent': FB_UA, 'Accept-Language': 'ko-KR,ko;q=0.9'},
                  timeout=15, follow_redirects=True)
    m = re.search(r'property="og:image" content="([^"]+)"', r.text)
    return m.group(1).replace('&amp;', '&') if m else None


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
    updates, ok, fail = [], 0, 0
    t0 = time.time()
    for i, r in enumerate(rows[:limit], 1):
        h = handle_of(r['instagram'])
        if not h:
            continue
        key = f'honsul/ig/{h}.webp'
        try:
            if object_exists(key):
                url = f'{PUBLIC_MEDIA_BASE}/media/{key}'
            else:
                img = og_image(h)
                if not img:
                    fail += 1; continue
                raw = httpx.get(img, headers={'User-Agent': IG_UA}, timeout=20, follow_redirects=True).content
                url = upload_bytes(key, to_webp(raw), 'image/webp')
            updates.append((r['id'], url))
            ok += 1
        except Exception as e:
            fail += 1
            print(f'  {h}: 실패 {str(e)[:50]}')
        if i % 25 == 0:
            print(f'  … {i}/{min(limit, len(rows))} · 성공 {ok} 실패 {fail} ({time.time()-t0:.0f}s)')
            _flush(updates); updates = []
        time.sleep(0.8)
    _flush(updates)
    print(f'완료 · 성공 {ok} · 실패 {fail} · {time.time()-t0:.0f}s')


def _flush(updates):
    if not updates:
        return
    vals = ','.join("('%s'::uuid, '%s')" % (cid, url.replace("'", "''")) for cid, url in updates)
    run_sql(f"update places as p set profile_image = c.url, thumbnail_url = c.url "
            f"from (values {vals}) as c(id, url) where p.id = c.id;")


if __name__ == '__main__':
    main()
