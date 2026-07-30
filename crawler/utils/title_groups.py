"""'같은 호스트가 올린 같은 모임'을 한 세트로 묶는다.

⚠️ admin/src/lib/titleGroups.ts 와 같은 규칙이어야 한다. 워치독이 "이 세트에
   상세 이미지가 없다"고 알리는데, admin 화면에서 보이는 세트와 다르면 오너가
   찾을 수 없다. 한쪽을 고치면 다른 쪽도 같이 고칠 것.

왜 필요한가(2026-07-30 오너): 문토·프립은 한 호스트가 같은 모임을 지역·나이·날짜만
바꿔 계속 올린다. 목록에는 제목이 전부 달라 보이지만 실제로는 몇 개 안 되는 모임이다.
세트로 묶으면 상세 이미지와 해시태그를 한 번에 같은 걸로 맞출 수 있다.
"""

import re
from typing import Optional

# 어느 모임에나 붙어 비교에 방해되는 말
GENERIC = (
    '로테이션소개팅', '로테이션', '소개팅', '모임', '파티', '만남',
    '신규오픈', '오픈', '특집', '현재', '모집', '마감', '임박',
)

EMOJI = re.compile(
    '[\U0001F000-\U0001FAFF←-⇿⌀-➿︀-️‍'
    '⬀-⯿©®]'
)

# 고유 부분이 이보다 짧으면 합치지 않는다 — 남은 글자가 몇 자 안 되면
# 우연히 비슷해 보여 엉뚱한 모임이 붙는다.
MIN_CORE = 4
MERGE_THRESHOLD = 0.5


def normalize(title: str) -> str:
    """제목에서 건마다 바뀌는 정보(날짜·나이·회차·가격)를 걷어낸다."""
    s = re.sub(r'^\[[^\]]*\]\s*', '', title or '')
    s = EMOJI.sub(' ', s)
    s = re.sub(r'\[[^\]]*\]', ' ', s)
    s = re.sub(r'\(\s*[월화수목금토일][^)]*\)', ' ', s)
    s = re.sub(r'\d{1,2}\s*[/.]\s*\d{1,2}', ' ', s)
    s = re.sub(r'\d{1,2}\s*시(\s*\d{1,2}\s*분)?', ' ', s)
    s = re.sub(r'\d{2}\s*[-~]\s*\d{2}', ' ', s)
    s = re.sub(r'\d{1,2}\s*0?대(만)?', ' ', s)
    s = re.sub(r'\d[\d,.]*\s*(원|만)', ' ', s)
    s = re.sub(r'[월화수목금토일]요일', ' ', s)
    s = re.sub(r'\d+', ' ', s)
    s = re.sub(r'[^\w가-힣]+', ' ', s)
    return ' '.join(s.split())


def core_of(title: str) -> str:
    """비교용 — 흔한 말을 뺀 '이 모임만의 부분'."""
    s = normalize(title).replace(' ', '')
    for g in GENERIC:
        s = s.replace(g, '')
    return s


def _shingles(s: str) -> set:
    out = {s[i:i + 2] for i in range(len(s) - 1)}
    return out or ({s} if s else set())


def _similarity(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _longest_common(a: str, b: str) -> str:
    if not a or not b:
        return ''
    best = ''
    for i in range(len(a)):
        j = len(a)
        while j > i + len(best):
            sub = a[i:j]
            if sub in b:
                if len(sub) > len(best):
                    best = sub
                break
            j -= 1
    return best


def _trim_fragment(s: str) -> str:
    """공통 문구 끝에 남는 잘린 조각을 떼어낸다('2차무료+매칭 [강' → '2차무료+매칭')."""
    out = s
    for op, cl in (('[', ']'), ('(', ')'), ('{', '}')):
        i = out.rfind(op)
        if i != -1 and out.find(cl, i) == -1:
            out = out[:i]
    out = re.sub(r'^[^\w가-힣]+', '', out)
    out = re.sub(r'[^\w가-힣]+$', '', out)
    return out.strip()


def common_keyword(titles: list) -> str:
    """세트 전체 제목에 공통으로 들어있는 가장 긴 문구 = 그대로 검색어로 쓸 수 있다."""
    uniq = list(dict.fromkeys(re.sub(r'^\[[^\]]*\]\s*', '', t).strip() for t in titles))
    if not uniq:
        return ''
    if len(uniq) == 1:
        return uniq[0]
    common = uniq[0]
    for t in uniq[1:]:
        if not common:
            break
        common = _longest_common(common, t)
    common = _trim_fragment(EMOJI.sub(' ', common).strip())
    return common if len(common) >= 2 else ''


def suggest_groups(rows: list) -> list:
    """rows=[{'title','url'}] → [{'rep','rows','keyword'}] 건수 많은 순."""
    # 1) 같은 상품(URL의 # 앞)은 무조건 한 덩어리
    by_product: dict = {}
    for r in rows:
        key = (r.get('url') or r.get('title') or '').split('#')[0]
        by_product.setdefault(key, []).append(r)

    units = []
    for lst in by_product.values():
        counts: dict = {}
        for r in lst:
            counts[r['title']] = counts.get(r['title'], 0) + 1
        rep = max(counts.items(), key=lambda kv: kv[1])[0]
        c = core_of(rep)
        units.append({'rows': list(lst), 'rep': rep, 'core': c, 'sh': _shingles(c)})
    units.sort(key=lambda u: -len(u['rows']))

    # 2) 고유 부분이 비슷하면 합친다. 비교는 항상 '세트 대표'와만 한다 —
    #    세트가 커질수록 아무거나 끌어당기는 것을 막기 위해서.
    clusters: list = []
    for u in units:
        best = None
        best_score = 0.0
        if len(u['core']) >= MIN_CORE:
            for c in clusters:
                if len(c['core']) < MIN_CORE:
                    continue
                s = _similarity(u['sh'], c['sh'])
                if s > best_score:
                    best_score, best = s, c
        if best is not None and best_score >= MERGE_THRESHOLD:
            best['rows'].extend(u['rows'])
        else:
            clusters.append(dict(u, rows=list(u['rows'])))

    clusters.sort(key=lambda c: -len(c['rows']))
    return [
        {'rep': c['rep'], 'rows': c['rows'],
         'keyword': common_keyword([r['title'] for r in c['rows']])}
        for c in clusters
    ]
