"""에모셔널오렌지 새 사이트(2026-09) 수집.

업체가 imweb 쇼핑몰에서 자체 사이트로 갈아탔다. 새 사이트는 React Router 로 만들어져
화면 주소 뒤에 `.data` 를 붙이면 **화면에 쓰는 자료를 그대로** 내려준다.
브라우저를 띄울 필요가 없어 훨씬 빠르고, HTML 모양이 바뀌어도 잘 안 깨진다.

  · 목록  https://emotional0ranges.com/meetups.data            → 모임 34개(제목·id)
  · 상세  https://emotional0ranges.com/meetups/{id}.data        → 그 모임의 날짜별 일정

옛 방식(HTML에서 가격·나이를 글자로 뽑아내기)보다 자료가 정확하다. 성별 가격·정원·
잔여석·얼리버드·나이 기준이 전부 숫자로 들어 있다.

⚠️ 이 형식은 «turbo-stream» 이라 값들이 서로를 번호로 가리킨다. 그대로 읽으면 안 되고
   resolve() 로 한 번 풀어야 보통 자료가 된다. 그리고 없는 값은 null 이 아니라 -5 같은
   «음수 번호»로 온다 — 그래서 숫자를 쓸 때는 반드시 _num() 으로 걸러야 한다.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

import httpx

logger = logging.getLogger('emotional-orange')

SITE = 'https://emotional0ranges.com'
UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
)


def _fetch_data(client: httpx.Client, path: str) -> Any:
    """`.data` 를 받아 turbo-stream 을 보통 자료로 풀어서 돌려준다."""
    r = client.get(f'{SITE}{path}.data', timeout=25)
    r.raise_for_status()
    flat = json.loads(r.text)

    def resolve(i: int, depth: int = 0):
        if depth > 16 or not isinstance(i, int) or not (0 <= i < len(flat)):
            return None
        v = flat[i]
        if isinstance(v, dict):
            out = {}
            for k, val in v.items():
                key = resolve(int(k[1:]), depth + 1) if k.startswith('_') else k
                out[str(key)] = (
                    resolve(val, depth + 1) if isinstance(val, int) and 0 <= val < len(flat) else val
                )
            return out
        if isinstance(v, list):
            return [
                resolve(x, depth + 1) if isinstance(x, int) and 0 <= x < len(flat) else x for x in v
            ]
        return v

    return resolve(0)


def _find(obj: Any, key: str):
    """중첩된 자료 어디에 있든 그 이름의 값을 찾아낸다(구조가 조금 바뀌어도 견디게)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                yield v
            yield from _find(v, key)
    elif isinstance(obj, list):
        for v in obj:
            yield from _find(v, key)


def _num(v: Any) -> Optional[int]:
    """없는 값이 -5 같은 «내부 번호»로 오므로, 0 이상인 진짜 숫자만 통과시킨다."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    n = int(v)
    return n if n >= 0 else None


def fetch_meetups() -> list[dict]:
    """모임 목록(id·제목). 실패하면 빈 목록."""
    with httpx.Client(headers={'User-Agent': UA}, follow_redirects=True) as c:
        top = _fetch_data(c, '/meetups')
        progs = next(_find(top, 'programs'), None)
        if not isinstance(progs, list):
            return []
        return [p for p in progs if isinstance(p, dict) and p.get('id')]


def fetch_sessions(meetup_id: str) -> tuple[dict, list[dict]]:
    """모임 하나의 정보와 날짜별 일정."""
    with httpx.Client(headers={'User-Agent': UA}, follow_redirects=True) as c:
        top = _fetch_data(c, f'/meetups/{meetup_id}')
        prog = next((p for p in _find(top, 'program') if isinstance(p, dict) and p.get('id')), None)
        if not isinstance(prog, dict):
            return {}, []
        sessions = prog.get('sessions')
        return prog, [s for s in (sessions or []) if isinstance(s, dict)]


def age_text(sess: dict) -> Optional[str]:
    """앱에 보여줄 나이 표기. 업체가 준 라벨이 있으면 그대로 쓰고, 없으면 출생연도로 만든다.

    ⚠️ 출생연도(년생)는 앱에 절대 안 쓴다(오너 규칙) — 만나이로 바꿔서 범위로 적는다.
    """
    lo, hi = _num(sess.get('birthYearMin')), _num(sess.get('birthYearMax'))
    if lo and hi:
        year = datetime.now().year
        a1, a2 = year - hi + 1, year - lo + 1      # 만나이 근사
        if 15 <= a1 <= 80 and 15 <= a2 <= 80:
            return f'{min(a1, a2)}~{max(a1, a2)}'
    return None
