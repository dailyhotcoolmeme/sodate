"""샘플: 네이버 place 대표사진(og:image) → R2 → profile_image. 인스타 대안 검토용.
  .venv/bin/python sample_naver_pic.py [limit]
"""
import io, os, re, sys, json, time, urllib.request
import httpx
from dotenv import load_dotenv
load_dotenv()
from PIL import Image, ImageFilter
from utils.r2_client import upload_bytes, object_exists, PUBLIC_MEDIA_BASE

PROJECT = 'kmakdtcavtheaqobktlj'
PAT = open(os.path.expanduser('~/.config/sodate/supabase-pat-moit')).read().strip()
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'


def run_sql(sql):
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query': sql}).encode(), method='POST',
        headers={'Authorization': f'Bearer {PAT}', 'Content-Type': 'application/json', 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def to_webp(raw, edge=320):
    """가로 사진이 잘리지 않게: 전체를 contain(꽉 맞춤)하고 뒤에 블러 배경 채움."""
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    w, h = im.size
    # 배경: cover(꽉 채움) + 블러
    sc = edge / min(w, h)
    bg = im.resize((max(edge, round(w * sc)), max(edge, round(h * sc))), Image.LANCZOS)
    bx, by = bg.size
    bg = bg.crop(((bx - edge) // 2, (by - edge) // 2, (bx - edge) // 2 + edge, (by - edge) // 2 + edge))
    bg = bg.filter(ImageFilter.GaussianBlur(14))
    # 전경: contain(전체 보임)
    sf = edge / max(w, h)
    fg = im.resize((max(1, round(w * sf)), max(1, round(h * sf))), Image.LANCZOS)
    bg.paste(fg, ((edge - fg.width) // 2, (edge - fg.height) // 2))
    buf = io.BytesIO()
    bg.save(buf, 'WEBP', quality=82, method=6)
    return buf.getvalue()


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    rows = run_sql("select id, naver_place_id, name from places where service='honsul' "
                   "and naver_place_id is not null and profile_image is null "
                   "order by naver_review_count desc nulls last limit %d;" % limit)
    print(f'대상 {len(rows)}곳')
    ok = 0
    for idx, r in enumerate(rows, 1):
        pid = r['naver_place_id']
        try:
            html = None
            for attempt in range(5):
                resp = httpx.get(f'https://m.place.naver.com/restaurant/{pid}/home',
                                 headers={'User-Agent': UA, 'Accept-Language': 'ko-KR'}, timeout=15, follow_redirects=True)
                if resp.status_code == 429:
                    w = 20 * (attempt + 1); print(f'    429 — {w}s 대기'); time.sleep(w); continue
                html = resp.text; break
            if not html:
                print(f'  {r["name"][:18]}: 429 반복'); continue
            m = re.search(r'property="og:image" content="([^"]+)"', html)
            og = m.group(1).replace('&amp;', '&') if m else None
            if not og or 'pstatic' not in og:
                print(f'  {r["name"][:20]}: og 없음'); continue
            raw = httpx.get(og, headers={'User-Agent': UA}, timeout=20, follow_redirects=True).content
            key = f'honsul/naverpic/{pid}.webp'
            url = upload_bytes(key, to_webp(raw), 'image/webp')
            run_sql("update places set profile_image=%s, thumbnail_url=%s where id=%s;"
                    % ("'" + url + "'", "'" + url + "'", "'" + r['id'] + "'"))
            ok += 1
            if idx % 25 == 0:
                print(f'  … {idx}/{len(rows)} · 성공 {ok}')
        except Exception as e:
            print(f'  {r["name"][:20]}: 실패 {str(e)[:40]}')
        time.sleep(0.8)
    print(f'완료 · 성공 {ok}/{len(rows)}')


if __name__ == '__main__':
    main()
