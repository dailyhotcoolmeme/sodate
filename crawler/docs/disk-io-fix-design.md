# Disk IO 절감 설계 — "바뀐 것만 쓰기" (2026-08-21)

## 배경

Supabase 가 sodate 프로젝트에 **Disk IO Budget 고갈** 경고를 주 1회씩 보낸다(8/21·8/9·8/2·7/26…).
진단 결과:

- events 테이블 행수는 **1,139개**뿐인데 **UPDATE 누적 258,017회** (행당 평균 226번 덮어씀)
- autovacuum **569회** — 죽은 행(dead tuple) 청소가 그만큼 자주 돌며 디스크를 읽고 씀
- 디스크 **읽기**는 캐시 적중 100%로 멀쩡. **문제는 쓰기(write)와 그로 인한 vacuum.**

원인은 **값이 바뀌든 안 바뀌든 무조건 write** 하는 두 지점:

| 파일:줄 | 무엇 | 주기 |
|---|---|---|
| `base_scraper.py:287` | `upsert(data, on_conflict='source_url')` — 이벤트마다 무조건 | 하루 2회 + refresh류 |
| `refresh_soldout.py:127` | `update(upd).eq('id', eid)` — 매칭된 이벤트마다 무조건 | **10분마다** |

`refresh-soldout` 이 10분마다(하루 144회) 전체 미래 이벤트의 seats/is_closed 를 다시 쓴다.
그런데 **실제로 마감·잔여석이 바뀌는 건 그중 극소수**다. 나머지는 "같은 값을 다시 쓰는" 순수 낭비.

## 핵심 원칙 — 실시간 정보는 절대 안 해친다

> **"안 쓴다 = 이미 DB 값이 맞다".** 앱이 보는 값은 100% 동일하다. 정보 지연 0.

```
현재:  마감됐든 안됐든        → 무조건 UPDATE
개선:  실제로 마감으로 바뀌면   → UPDATE  (값이 달라졌으니)
       여전히 모집중이면        → 안 씀    (이미 모집중이라 DB가 이미 맞음)
```

칠판에 "모집중"이라 써 있는데 여전히 모집중이면 지웠다 다시 안 쓴다. 보는 사람에겐 똑같고 분필만 아낀다.

## ⚠️ 반드시 막아야 할 3가지 함정 (오너가 지적한 "제대로 확인")

### ① 타입 불일치로 오판 — 가장 위험
DB 현재값과 크롤값을 비교할 때 타입이 미묘하게 다르면 매번 "달라졌다"로 오판해 결국 또 다 쓴다.
반대로 너무 관대하게 비교하면 진짜 변경을 놓친다.

**대책 — 필드별로 명시적 정규화 후 비교:**
- `is_closed`: `bool(a) == bool(b)` (None/false 를 같게)
- `seats_left_male/female`, `price_male/female`: 숫자로 캐스팅 후 비교. `None` 과 `0` 은 **다르게** 취급
  (0=마감, None=정보없음 — 의미가 다르다). `int(a) == int(b)` 로 5.0 vs 5 흡수.
- 문자열/배열(title, hashtags, thumbnail_urls): 값 그대로 `==`. 배열은 순서까지 같아야 같음.

### ② 비교용 읽기가 새 IO 를 만들면 도루묵
비교하려면 현재 값을 읽어야 한다. 이걸 이벤트마다 따로 읽으면 write 줄인 만큼 read 가 는다.

**대책 — 이미 하는 읽기에 필드만 얹는다(추가 쿼리 0):**
- `refresh_soldout.py`: 지금도 `select('id,source_url')` 를 **한 번에** 읽는다(84줄).
  여기에 `seats_left_male, seats_left_female, is_closed, price_male, price_female` 만 추가하면
  **쿼리 수는 그대로**, 각 이벤트의 현재값을 메모리에서 비교할 수 있다.
- `base_scraper.py`: verified 목록을 이미 한 번에 읽는다(129줄). 같은 방식으로 현재값을 한 번에
  읽어 dict 로 들고 비교. (upsert 대상 필드만 select)

### ③ 마감 반영이 실제로 되는지 — 배포 전 실측 필수
"바뀐 것만 쓴다"가 **바뀐 걸 제대로 감지하는지**는 코드리뷰만으론 부족하다.

**대책 — 배포 후 실측:**
1. 실제로 마감된 이벤트 하나를 골라, refresh-soldout 한 사이클 뒤 DB `is_closed=true` 로 바뀌는지 확인
2. 반대로 모집중 이벤트가 `is_closed` 를 계속 false 로 유지하는지(불필요 write 없이) 확인
3. `pg_stat_user_tables` 의 `n_tup_upd` 증가량이 before/after 로 실제 줄었는지 숫자로 비교

## 구현 방식 (승인 후)

### refresh_soldout.py
```python
# 84줄: 현재값도 같이 읽는다 (쿼리 수 동일)
dbevs = sb.table('events').select(
    'id,source_url,seats_left_male,seats_left_female,is_closed,price_male,price_female'
).eq('company_id', cid).eq('is_active', True).execute().data
cur_by_id = {r['id']: r for r in dbevs}

# 127줄: 무조건 update → 바뀐 필드만 골라 update, 바뀐 게 없으면 skip
changed = {k: v for k, v in upd.items() if _differs(cur_by_id[eid].get(k), v)}
if changed:
    sb.table('events').update(changed).eq('id', eid).execute()
    updated += 1
# else: skip (DB가 이미 맞음)
```

### base_scraper.py
같은 원리. upsert 전에 현재 행과 비교해서 **바뀐 필드가 하나도 없으면 upsert 자체를 건너뛴다.**
새 이벤트(현재 행 없음)는 당연히 insert. source_url 로 매칭.

### 공용 비교 함수
```python
def _differs(old, new) -> bool:
    if old is None and new is None: return False
    if (old is None) != (new is None): return True      # None ↔ 값 은 변경
    if isinstance(new, bool) or isinstance(old, bool):
        return bool(old) != bool(new)
    if isinstance(new, (int, float)) and isinstance(old, (int, float)):
        return int(old) != int(new)
    return old != new
```

## 기대 효과

refresh-soldout 이 10분마다 1,100건을 "다시 쓰던" 것이, **실제 변경분(수십 건 이하)만** 쓴다.
UPDATE 량 대략 90%+ 감소 예상 → dead tuple·autovacuum 동반 감소 → Disk IO 경고 해소.
컴퓨트 업그레이드(월 비용) 불필요.

## 되돌리기

각 파일에서 비교 없이 무조건 write 하던 원래 코드로 한 줄씩 되돌리면 즉시 원복.
위험하면 `_differs` 를 항상 True 반환으로 바꾸기만 해도 "무조건 쓰기"로 즉시 복귀(안전핀).
