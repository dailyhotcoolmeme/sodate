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
from datetime import datetime, timezone

import httpx

from utils.supabase_client import get_supabase
from price_accuracy_check import check_completeness, check_field_consistency

REPO = 'dailyhotcoolmeme/sodate'
GH_API = f'https://api.github.com/repos/{REPO}/actions/workflows'

# workflow 파일명 → (사람이 읽는 이름, 최대 허용 공백(분))
HEARTBEATS = {
    'crawl.yml': ('메인 크롤(하루 2회)', 16 * 60),          # 12h 주기 + 여유
    'refresh-soldout.yml': ('15분 가격갱신', 45),           # 15분 주기 + 여유
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


def _gh_dispatch(fname: str) -> bool:
    """워크플로를 API로 수동 발화(workflow_dispatch)한다.
    2026-07-25: refresh-soldout.yml의 schedule 트리거가 GH 쪽에서 3시간+ 안 도는 사고가
    있었고, 워크플로 파일 touch·disable/enable 재등록 둘 다 효과 없었음. 근본원인을
    못 밝혀도(GH 플랫폼 이슈로 추정) 사업적으로는 "가격이 최신인가"가 중요하므로,
    워치독이 갭을 발견하면 알림만 보내지 말고 직접 재발화까지 시켜 스스로 복구한다."""
    try:
        r = httpx.post(
            f'{GH_API}/{fname}/dispatches',
            headers=_gh_headers(),
            json={'ref': 'main'},
            timeout=15,
        )
        return r.status_code == 204
    except Exception:
        return False


def check_heartbeats() -> list[dict]:
    """워크플로별 마지막 성공 실행이 예상 주기 안인지 확인(트리거 종류 무관 — 수동실행도 정상 신호).
    갭 발견 시 알림뿐 아니라 workflow_dispatch로 즉시 재발화까지 시도(자가복구)."""
    issues = []
    now = datetime.now(timezone.utc)
    for fname, (label, max_gap_min) in HEARTBEATS.items():
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
            dispatched = _gh_dispatch(fname)
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


def run() -> int:
    sb = get_supabase()

    print('[1/3] 하트비트(마지막 성공 실행 시각) 확인...')
    heartbeat_issues = check_heartbeats()

    print('[2/3] 완성도(가격+나이) 점검...')
    completeness_issues = check_completeness(sb)

    print('[3/3] price_detail 정합성 점검...')
    consistency_issues = check_field_consistency(sb)

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
