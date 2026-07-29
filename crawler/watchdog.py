"""독립 워치독 — 다른 파이프라인(crawl.yml/refresh-soldout.yml)이 죽어도 혼자 살아서 감시한다.

2026-07-25 사고 계기로 신설: price_accuracy_check.py는 crawl.yml *안에서* 도는 한 스텝이라
crawl.yml 자체가 타임아웃/실패하면 같이 못 돈다(실제로 그날 아침 그렇게 됐음). 이 워치독은
- 별도 워크플로(watchdog.yml)에서, 별도 스케줄로
- Playwright 등 무거운 의존성 없이(그래서 덜 죽는다)
- GitHub Actions API로 다른 두 워크플로의 "심장박동"(마지막 성공 실행 시각)까지 확인하고
- 문제가 있으면 로그가 아니라 카카오톡으로 오너에게 직접 알린다.

세 가지를 검사한다.
1. 하트비트 — crawl.yml/refresh-soldout.yml이 예상 주기 안에 성공적으로 돌았는지.
2. 완성도 — price_accuracy_check.check_completeness() 재사용.
3. 필드 정합성 — price_accuracy_check.check_field_consistency() 재사용.

라이브 재검증(실사이트 대조)은 일부러 안 한다 — 그건 crawl.yml의 price_accuracy_check.py가
이미 하루 2번 하고 있고, 워치독은 "더 자주 도는 대신 가볍게"가 존재 이유라 무거운 검사를
중복으로 넣으면 워치독 자신도 똑같이 깨지기 쉬워진다(오늘 교훈: 감시자는 단순해야 안 죽는다).
"""
import os
import sys
from datetime import datetime, timezone, timedelta

import httpx

from utils.supabase_client import get_supabase
from price_accuracy_check import check_completeness, check_field_consistency

REPO = 'dailyhotcoolmeme/sodate'
GH_API = f'https://api.github.com/repos/{REPO}/actions/workflows'

# workflow 파일명 → (사람이 읽는 이름, 최대 허용 공백(분))
# workflow 파일명 → (사람이 읽는 이름, 최대 허용 공백(분), 재발화 시 넘길 inputs)
# ⚠️ 재발화 inputs가 없으면 refresh-soldout.yml이 '전체 갱신'(20~30분) 분기로 떨어진다.
#    15분 주기에 30분짜리를 계속 띄우면 큐가 밀려 절반이 취소되고, 성공 간격이 벌어져
#    워치독이 또 재발화하는 악순환이 된다(2026-07-29 실측: 성공 실행 18~29분).
#    그래서 자가복구 재발화는 '임박 2일'만 도는 가벼운 분기로 명시해서 띄운다.
HEARTBEATS = {
    'crawl.yml': ('메인 크롤(하루 2회)', 16 * 60, {}),           # 12h 주기 + 여유
    'refresh-soldout.yml': ('15분 imweb 갱신', 45, {'days': '2'}),   # 15분 주기 + 여유
    'refresh-nonimweb.yml': ('30분 프립·토크·괜찮소 갱신', 100, {}),  # 30분 주기 + CI 14분 + 여유
}


def _gh_headers() -> dict:
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    headers = {'Accept': 'application/vnd.github+json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return headers


def _gh_get(path: str) -> dict:
    r = httpx.get(f'{GH_API}/{path}', headers=_gh_headers(), timeout=15)
    r.raise_for_status()
    return r.json()


def _gh_dispatch(fname: str, inputs: dict | None = None) -> bool:
    """워크플로를 API로 수동 발화(workflow_dispatch)한다.
    2026-07-25: refresh-soldout.yml의 schedule 트리거가 GH 쪽에서 3시간+ 안 도는 사고가
    있었고, 워크플로 파일 touch·disable/enable 재등록 둘 다 효과 없었음. 근본원인을
    못 밝혀도(GH 플랫폼 이슈로 추정) 사업적으로는 "가격이 최신인가"가 중요하므로,
    워치독이 갭을 발견하면 알림만 보내지 말고 직접 재발화까지 시켜 스스로 복구한다."""
    try:
        body: dict = {'ref': 'main'}
        if inputs:
            body['inputs'] = inputs
        r = httpx.post(
            f'{GH_API}/{fname}/dispatches',
            headers=_gh_headers(),
            json=body,
            timeout=15,
        )
        return r.status_code == 204
    except Exception:
        return False


def _has_active_run(fname: str) -> bool:
    """해당 워크플로가 지금 대기·실행 중인지. 중복 재발화로 큐를 밀어내지 않기 위함."""
    for st in ('queued', 'in_progress'):
        try:
            d = _gh_get(f'{fname}/runs?status={st}&per_page=1')
            if (d.get('workflow_runs') or []):
                return True
        except Exception:
            pass
    return False


def check_heartbeats() -> list[dict]:
    """워크플로별 마지막 성공 실행이 예상 주기 안인지 확인(트리거 종류 무관 — 수동실행도 정상 신호).
    갭 발견 시 알림뿐 아니라 workflow_dispatch로 즉시 재발화까지 시도(자가복구)."""
    issues = []
    now = datetime.now(timezone.utc)
    for fname, (label, max_gap_min, dispatch_inputs) in HEARTBEATS.items():
        try:
            data = _gh_get(f'{fname}/runs?status=success&per_page=1')
            runs = data.get('workflow_runs') or []
        except Exception as e:
            issues.append({'level': 'WARN', 'msg': f'{label}: GH API 조회 실패({str(e)[:60]})'})
            continue
        if not runs:
            issues.append({'level': 'ERROR', 'msg': f'{label}: 성공 실행 이력이 아예 없음'})
            continue
        last = runs[0]
        finished = last.get('updated_at') or last.get('run_started_at')
        try:
            finished_dt = datetime.fromisoformat(finished.replace('Z', '+00:00'))
        except Exception:
            continue
        gap_min = (now - finished_dt).total_seconds() / 60
        if gap_min > max_gap_min:
            # ⚠️ 이미 돌고 있으면 재발화하지 않는다. 예전엔 무조건 띄워서, 오래 걸리는
            #    실행이 끝나기 전에 계속 큐를 채웠고 GH가 대기분을 취소해 버렸다.
            if _has_active_run(fname):
                issues.append({
                    'level': 'WARN',
                    'msg': f'{label}: 마지막 성공이 {gap_min:.0f}분 전이지만 지금 실행 중 — 재발화 안 함',
                })
                continue
            dispatched = _gh_dispatch(fname, dispatch_inputs)
            issues.append({
                'level': 'ERROR',
                'msg': f'{label}: 마지막 성공 실행이 {gap_min:.0f}분 전(허용 {max_gap_min}분) — '
                       f'스케줄이 멈췄을 가능성. ' + ('지금 자동 재발화함' if dispatched else '자동 재발화 실패'),
            })
    return issues


def build_message(heartbeat_issues, completeness_issues, consistency_issues) -> str | None:
    errors = [i for i in heartbeat_issues if i['level'] == 'ERROR'] \
        + [i for i in completeness_issues if i['level'] == 'ERROR'] \
        + [i for i in consistency_issues if i['level'] == 'ERROR']
    if not errors:
        return None
    now_kst = datetime.now(timezone.utc).astimezone().strftime('%m/%d %H:%M')
    lines = [f'🚨 소개팅모아 워치독 ({now_kst})', f'문제 {len(errors)}건 발견:']
    for i in errors[:8]:
        lines.append(f'· {i.get("company", "")} {i["msg"]}'.strip())
    if len(errors) > 8:
        lines.append(f'... 외 {len(errors) - 8}건 더')
    return '\n'.join(lines)


def send_kakao(text: str) -> None:
    rest_api_key = os.environ.get('KAKAO_REST_API_KEY')
    client_secret = os.environ.get('KAKAO_CLIENT_SECRET')
    refresh_token = os.environ.get('KAKAO_REFRESH_TOKEN')
    if not rest_api_key or not refresh_token:
        print('KAKAO_REST_API_KEY/KAKAO_REFRESH_TOKEN 미설정 — 알림 전송 스킵(로그만 남김)')
        print(text)
        return
    # 이 앱은 '클라이언트 시크릿 사용'이 켜져 있어 refresh_token 갱신 때도 필수(2026-07-25 확인).
    data = {
        'grant_type': 'refresh_token',
        'client_id': rest_api_key,
        'refresh_token': refresh_token,
    }
    if client_secret:
        data['client_secret'] = client_secret
    tok = httpx.post('https://kauth.kakao.com/oauth/token', data=data, timeout=15)
    tok.raise_for_status()
    access_token = tok.json()['access_token']

    import json as _json
    template = {
        'object_type': 'text',
        'text': text,
        'link': {'web_url': 'https://github.com/dailyhotcoolmeme/sodate/actions',
                  'mobile_web_url': 'https://github.com/dailyhotcoolmeme/sodate/actions'},
    }
    r = httpx.post(
        'https://kapi.kakao.com/v2/api/talk/memo/default/send',
        headers={'Authorization': f'Bearer {access_token}'},
        data={'template_object': _json.dumps(template)},
        timeout=15,
    )
    print(f'카카오 전송 결과: {r.status_code} {r.text[:200]}')


def send_email(text: str) -> None:
    """Resend API로 이메일 전송. 카카오 '나에게 보내기'는 푸시알림이 안 떠서(2026-07-25 확인)
    실제 알아채는 용도는 이메일이 정본 — 둘 다 보내되 이메일이 주력."""
    api_key = os.environ.get('RESEND_API_KEY')
    to_addr = os.environ.get('ALERT_EMAIL')
    if not api_key or not to_addr:
        print('RESEND_API_KEY/ALERT_EMAIL 미설정 — 이메일 전송 스킵(로그만 남김)')
        return
    r = httpx.post(
        'https://api.resend.com/emails',
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
        json={
            'from': 'Sodate Watchdog <onboarding@resend.dev>',
            'to': [to_addr],
            'subject': '🚨 소개팅모아 워치독 — 문제 발견',
            'text': text,
        },
        timeout=15,
    )
    print(f'이메일 전송 결과: {r.status_code} {r.text[:200]}')


def check_empty_crawls(sb) -> list[dict]:
    """결과가 0건인데 success로 기록된 크롤을 잡는다.

    ⚠️ 사이트가 잠깐 죽거나 파싱이 깨지면 스크래퍼가 0건을 들고 와도 예외가 아니라
       'success'로 남는다. base_scraper의 50% 안전장치가 삭제는 막아주지만, 아무도
       모르는 채로 그 업체 데이터가 낡아간다(2026-07-29 에모셔널오렌지에서 실제 발생:
       252건 → 0건 크롤이 success로 기록됨). 그래서 여기서 따로 본다.
    """
    issues: list[dict] = []
    since = (datetime.now(timezone.utc) - timedelta(hours=14)).isoformat()
    try:
        comps = {c['id']: c['name'] for c in sb.table('companies').select('id,name').execute().data}
        logs = (
            sb.table('crawl_logs')
            .select('company_id,status,events_found,executed_at')
            .gte('executed_at', since)
            .order('executed_at', desc=True)
            .execute()
        ).data or []
    except Exception as e:
        return [{'level': 'WARN', 'msg': f'빈 크롤 점검 실패({str(e)[:60]})'}]

    latest: dict = {}
    for lg in logs:
        latest.setdefault(lg['company_id'], lg)
    for cid, lg in latest.items():
        if lg.get('status') == 'success' and (lg.get('events_found') or 0) == 0:
            issues.append({
                'level': 'ERROR',
                'msg': f"{comps.get(cid, cid)}: 최근 크롤이 0건인데 성공으로 기록됨 — 사이트 변경·파싱 깨짐 의심",
            })
    return issues


# 업체별 "정상 범위" 판정에 쓰는 기준. 표본이 적으면 노이즈가 커서 최소 건수를 둔다.
DRIFT_MIN_EVENTS = 5          # 이보다 적은 업체는 비율 판정을 건너뜀
DRIFT_DROP_RATIO = 0.6        # 최근 크롤 건수가 평소의 60% 미만이면 급락으로 본다
DRIFT_CLOSED_RATIO = 0.9      # 앞으로 일정의 90% 이상이 마감이면 오표시 의심


def check_data_drift(sb) -> list[dict]:
    """값이 '조용히 틀어지는 것'을 잡는다. crawl_logs와 현재 events만 보므로 별도 표가 필요 없다.

    ⚠️ 왜 필요한가(2026-07-29): 그동안 워치독은 "돌았는가 / 비었는가"만 봤다. 그래서
       아래가 전부 crawl_logs에 success로 기록된 채 틀려 있었고 사람 눈으로 발견됐다.
         · 토크블라썸: 재고 미사용 쇼핑몰의 stock=0을 마감으로 읽어 8건 전부 마감 오표시
         · 이연시: 파싱이 깨져 21일간 0건(→ check_empty_crawls가 담당)
       여기서 보는 것:
         1) 건수 급락  — 최근 크롤이 평소의 60% 미만
         2) 마감률 이상 — 앞으로 일정이 90% 이상 마감(한 업체 전체가 마감일 리 없다)
         3) 결측 전멸  — 가격이 있던 업체의 앞으로 일정에 가격이 하나도 없음
    """
    issues: list[dict] = []
    try:
        comps = {c['id']: c['name'] for c in sb.table('companies').select('id,name').execute().data}
        now_iso = datetime.now(timezone.utc).isoformat()
        rows = []
        for off in range(0, 4000, 1000):
            d = (sb.table('events')
                 .select('company_id,is_closed,price_male,price_female,seats_left_male,seats_left_female')
                 .gte('event_date', now_iso).range(off, off + 999).execute()).data or []
            rows += d
            if len(d) < 1000:
                break
        logs = (sb.table('crawl_logs').select('company_id,status,events_found,executed_at')
                .order('executed_at', desc=True).limit(500).execute()).data or []
    except Exception as e:
        return [{'level': 'WARN', 'msg': f'데이터 드리프트 점검 실패({str(e)[:60]})'}]

    # 1) 건수 급락 — 최근 성공 크롤 vs 그 이전 성공 크롤들의 중앙값
    by_comp: dict = {}
    for lg in logs:
        if lg.get('status') == 'success':
            by_comp.setdefault(lg['company_id'], []).append(lg.get('events_found') or 0)
    for cid, counts in by_comp.items():
        if len(counts) < 4:
            continue
        latest, past = counts[0], sorted(counts[1:11])
        if not past:
            continue
        median = past[len(past) // 2]
        if median >= DRIFT_MIN_EVENTS and latest < median * DRIFT_DROP_RATIO:
            issues.append({
                'level': 'ERROR',
                'msg': f'{comps.get(cid, cid)}: 최근 크롤 {latest}건 — 평소 {median}건의 '
                       f'{latest * 100 // max(median, 1)}%로 급락(사이트 변경·부분 파싱 실패 의심)',
            })

    # 2)(3) 현재 데이터 기준 비율 이상
    agg: dict = {}
    for r in rows:
        a = agg.setdefault(r['company_id'], {'n': 0, 'closed': 0, 'noprice': 0})
        a['n'] += 1
        sm, sf = r.get('seats_left_male'), r.get('seats_left_female')
        if r.get('is_closed') or (sm == 0 and sf == 0):
            a['closed'] += 1
        if r.get('price_male') is None and r.get('price_female') is None:
            a['noprice'] += 1
    for cid, a in agg.items():
        if a['n'] < DRIFT_MIN_EVENTS:
            continue
        name = comps.get(cid, cid)
        if a['closed'] >= a['n'] * DRIFT_CLOSED_RATIO:
            issues.append({
                'level': 'ERROR',
                'msg': f'{name}: 앞으로 일정 {a["n"]}건 중 {a["closed"]}건이 마감 — '
                       f'한 업체 전체가 마감일 가능성은 낮다(마감 판정 오류 의심)',
            })
        if a['noprice'] == a['n']:
            issues.append({
                'level': 'ERROR',
                'msg': f'{name}: 앞으로 일정 {a["n"]}건 전부 가격 없음 — 가격 파싱 깨짐 의심',
            })
    return issues


def run() -> int:
    sb = get_supabase()

    print('[1/5] 하트비트(마지막 성공 실행 시각) 확인...')
    heartbeat_issues = check_heartbeats()

    print('[2/5] 완성도(가격+나이) 점검...')
    completeness_issues = check_completeness(sb)

    print('[3/5] price_detail 정합성 점검...')
    consistency_issues = check_field_consistency(sb)

    print('[4/5] 빈 크롤(0건인데 success) 점검...')
    consistency_issues += check_empty_crawls(sb)

    print('[5/5] 데이터 드리프트(건수 급락·마감률·가격 결측) 점검...')
    consistency_issues += check_data_drift(sb)

    all_issues = heartbeat_issues + completeness_issues + consistency_issues
    errors = [i for i in all_issues if i['level'] == 'ERROR']
    print(f'\n총 {len(errors)}건 ERROR')
    for i in errors:
        print(f'  ✗ {i}')

    msg = build_message(heartbeat_issues, completeness_issues, consistency_issues)
    if msg:
        # 둘 다 시도 — 하나 실패해도 다른 하나는 계속 보낸다(알림 자체가 감시자니까 여기도
        # "한 건 실패가 전체를 못 죽인다" 원칙 적용).
        try:
            send_email(msg)
        except Exception as e:
            print(f'이메일 전송 실패: {e}')
        try:
            send_kakao(msg)
        except Exception as e:
            print(f'카카오 전송 실패: {e}')
        print(msg)

    return len(errors)


if __name__ == '__main__':
    sys.exit(1 if run() > 0 else 0)
