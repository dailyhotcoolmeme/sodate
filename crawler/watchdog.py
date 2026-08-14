"""독립 워치독 — 다른 파이프라인(crawl.yml/refresh-soldout.yml)이 죽어도 혼자 살아서 감시한다.

2026-07-25 사고 계기로 신설: price_accuracy_check.py는 crawl.yml *안에서* 도는 한 스텝이라
crawl.yml 자체가 타임아웃/실패하면 같이 못 돈다(실제로 그날 아침 그렇게 됐음). 이 워치독은
- 별도 워크플로(watchdog.yml)에서, 별도 스케줄로
- Playwright 등 무거운 의존성 없이(그래서 덜 죽는다)
- GitHub Actions API로 다른 두 워크플로의 "심장박동"(마지막 성공 실행 시각)까지 확인하고
- 문제가 있으면 로그가 아니라 카카오톡으로 오너에게 직접 알린다.

여섯 가지를 검사한다.
1. 하트비트 — crawl.yml/refresh-soldout.yml이 예상 주기 안에 성공적으로 돌았는지.
2. 완성도 — price_accuracy_check.check_completeness() 재사용.
3. 필드 정합성 — price_accuracy_check.check_field_consistency() 재사용.
4. 빈 크롤·연속 실패 — 0건인데 success로 남은 크롤, 며칠째 실패 중인 업체.
5. 데이터 드리프트 — 건수 급락·마감률 이상·가격 결측 전멸.
6. 상세 이미지 유형이 없는 모임 세트.

결과는 두 갈래로 나눠 보낸다(2026-08-14). '일정이 지금 썩고 있다'(1·4·건수급락)는
긴급 메일로 즉시, '천천히 채워 넣을 과제'(2·3·5의 나머지·6)는 하루 1회 요약 메일로.
섞어 보내던 시절엔 발송량의 3분의 2가 운영 과제라 진짜 장애가 묻혔다 — 아래 URGENT_KIND 주석 참고.

라이브 재검증(실사이트 대조)은 일부러 안 한다 — 그건 crawl.yml의 price_accuracy_check.py가
이미 하루 2번 하고 있고, 워치독은 "더 자주 도는 대신 가볍게"가 존재 이유라 무거운 검사를
중복으로 넣으면 워치독 자신도 똑같이 깨지기 쉬워진다(오늘 교훈: 감시자는 단순해야 안 죽는다).
"""
import os
import re
import hashlib
import sys
from datetime import datetime, timezone, timedelta

import httpx

from utils.supabase_client import get_supabase
from price_accuracy_check import check_completeness, check_field_consistency
from utils.title_groups import suggest_groups

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
    'refresh-soldout.yml': ('10분 imweb 갱신', 35, {'days': '2'}),   # 10분 주기 + 실행 6분 + 여유
    'refresh-nonimweb.yml': ('15분 비imweb 갱신', 45, {'days': '2'}),  # 15분 주기 + 실행 + 여유
    # 주 1회라 조용히 실패하면 일주일이 빈다. 넉넉히 8일로 두고 그때만 잡는다
    # (2026-07-31 오너 승인). 자가복구 재발화가 먹으면 메일은 안 나간다.
    'reviews.yml': ('주1회 후기 크롤', 8 * 24 * 60, {}),
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


# ── 알림 방침(2026-07-30 오너 지적: "메일을 봐도 어떤 상태인지 전혀 모르겠다") ──
# 이전에는 무엇이든 "🚨 문제 발견"으로 똑같이 보냈다. 워치독이 스스로 되살린 건과
# 오너가 직접 봐야 하는 건이 구분되지 않아, 조치가 필요한지 알 수 없었다.
# 그리고 같은 문제가 해결되기 전까지 20분마다 같은 메일이 반복됐다.
#   → 제목에서 조치 필요 여부를 먼저 밝히고, 본문을 두 묶음으로 나눈다.
#   → 같은 내용은 REPEAT_SILENCE_HOURS 안에는 다시 보내지 않는다.
REPEAT_SILENCE_HOURS = 6
# 상세 이미지 유형이 없는 세트는 '지금 당장'이 아니라 꾸준히 해나가는 일이라
# 하루 1회로 묶는다(오너: 워치독 메일이 시끄럽다).
MISSING_TYPE_SILENCE_HOURS = 24
# 자가복구(재발화)는 평소엔 알리지 않는다. 다만 짧은 시간에 반복되면 자동조치가
# 듣지 않는다는 뜻이므로 그때는 알린다.
AUTO_ESCALATE_COUNT = 3
AUTO_ESCALATE_HOURS = 2

# ── 긴급/운영 분리(2026-08-14) ──
# 감시는 멀쩡했는데 3일간 아무도 손을 못 댄 사고가 났다(유니브리지소셜·오프더레코드가
# 8/11 마지막 성공 이후 8회 연속 실패, 그동안 유령 일정 19건이 앱에 "신청 가능"으로
# 노출). check_failing_crawls는 그걸 매 실행 정확히 잡아 6시간마다 메일까지 보내고
# 있었다 — 묻힌 게 문제였다. 실측: 최근 7일 발송 36건 중 24건(67%)이 '상세 이미지
# 유형 없음'이었고, 그건 장애가 아니라 오너가 admin에서 채워 넣는 운영 과제다.
# 프립·문토는 모임 제목이 매일 바뀌어 지문이 계속 새로 생기니 24시간 억제도 안 먹었다.
#   → 'urgent'(일정이 지금 썩고 있다)와 'ops'(천천히 해나갈 과제)를 아예 다른 메일로 보낸다.
URGENT_KIND, OPS_KIND = 'urgent', 'ops'
# 운영 과제는 하루 한 통으로 묶는다. 개별 지문 억제 대신 요약 전체에 자물쇠를 건다 —
# 위 이유로 개별 억제는 구조적으로 새는 반면, 요약 자물쇠는 문구가 어떻게 바뀌든 하루 1통을 보장한다.
OPS_DIGEST_FINGERPRINT = 'ops-digest-daily'
OPS_DIGEST_SILENCE_HOURS = 24
OPS_DIGEST_MAX_LINES = 12
# 같은 긴급 문제가 이만큼 이어지면 '방치'로 보고 억제를 풀어 자주 알린다.
# 워치독은 20분마다 도는데 억제를 완전히 풀면 하루 72통이 되므로 1시간으로 잡는다.
ESCALATE_AFTER_DAYS = 3
ESCALATED_SILENCE_HOURS = 1


def _tag(issues: list[dict], kind: str) -> list[dict]:
    """점검 결과에 긴급/운영 꼬리표를 단다. 점검 함수가 직접 지정한 건 건드리지 않는다
    (예: 건수 급락은 check_data_drift 안에서 urgent로 명시)."""
    for i in issues:
        i.setdefault('kind', kind)
    return issues


def _fingerprint_text(issue: dict) -> str:
    """사람이 읽는 지문 원문. 숫자(경과 분·건수)는 매번 달라지므로 지운다."""
    raw = f'{issue.get("company", "")}|{issue["msg"]}'
    return re.sub(r'\d+', '#', raw)[:300]


def _fingerprint(issue: dict) -> str:
    """조회 키. 원문을 그대로 쓰면 따옴표·괄호·화살표 때문에 PostgREST의 in 필터가
    조용히 빈 결과를 돌려줘 반복 억제가 아예 동작하지 않았다(2026-07-30).
    특수문자 없는 해시로 쓴다. 원문은 note 컬럼에 남긴다."""
    return hashlib.md5(_fingerprint_text(issue).encode('utf-8')).hexdigest()


def _needs_owner(issue: dict) -> bool:
    """오너가 직접 봐야 하는 건인지. 워치독이 재발화로 되살린 건은 아니다."""
    if issue.get('action') == 'owner':
        return True
    return '자동 재발화함' not in issue['msg']


def load_alert_state(sb, fingerprints: list[str]) -> dict:
    if not fingerprints:
        return {}
    try:
        rows = sb.table('watchdog_alerts').select('*').in_('fingerprint', fingerprints).execute().data
        return {r['fingerprint']: r for r in rows}
    except Exception as e:
        print(f'알림 이력 조회 실패(반복 억제 없이 진행): {e}')
        return {}


def record_alert(sb, fp: str, prev: dict | None, sent: bool, note: str = '') -> None:
    now = datetime.now(timezone.utc).isoformat()
    row = {
        'fingerprint': fp,
        'last_seen_at': now,
        'seen_count': (prev.get('seen_count', 0) if prev else 0) + 1,
    }
    if note:
        row['note'] = note[:300]
    if sent:
        row['last_sent_at'] = now
    elif prev and prev.get('last_sent_at'):
        row['last_sent_at'] = prev['last_sent_at']
    if not prev:
        row['first_seen_at'] = now
    try:
        sb.table('watchdog_alerts').upsert(row, on_conflict='fingerprint').execute()
    except Exception as e:
        print(f'알림 이력 기록 실패(무시): {e}')


def _persisted_days(issue: dict, prev: dict | None, now: datetime) -> float:
    """이 문제가 며칠째 이어지고 있는지.

    ⚠️ first_seen_at(알림 이력)만 믿으면 안 된다. 지문은 company와 msg로 만드는데,
       점검 코드에서 필드 하나만 손대도 지문이 바뀌어 first_seen_at이 0으로 리셋된다
       (2026-08-14 실측: check_failing_crawls에 company를 추가하자 3일째 방치 중이던
       유니브리지소셜·오프더레코드가 seen_count 123 → 1이 되며 '0일째'로 잡혔고,
       하필 그 에스컬레이션을 만들자마자 무력화됐다).
       → 문제 자체가 지속 기간을 아는 점검(예: '마지막 성공이 3일 전')은 그 값을
         issue['persisted_days']로 직접 실어 보낸다. 그게 있으면 무조건 그쪽이 정본이다.
    """
    own = issue.get('persisted_days')
    if own is not None:
        return float(own)
    if not prev or not prev.get('first_seen_at'):
        return 0.0
    try:
        first = datetime.fromisoformat(prev['first_seen_at'].replace('Z', '+00:00'))
    except Exception:
        return 0.0
    return (now - first).total_seconds() / 86400


def _bullet(issue: dict) -> str:
    """본문 한 줄. 업체명이 없는 항목에서 공백이 두 칸 되거나(예전 f-string) 줄 전체를
    .strip() 해서 들여쓰기가 통째로 날아가던 것을 여기서 한 번에 정리한다."""
    name = (issue.get('company') or '').strip()
    body = issue['msg']
    # 문구가 이미 업체명으로 시작하면(대부분의 크롤 실패·드리프트) 겹쳐 쓰지 않는다.
    head = f'{name} ' if name and not body.startswith(name) else ''
    return f'  · {head}{body}'


def _company_label(items: list) -> str:
    """제목에 박을 업체명. 메일을 열기 전에 어느 업체가 썩고 있는지 알 수 있어야 한다."""
    names: list[str] = []
    for entry in items:
        name = (entry[2].get('company') or '').strip()
        if name and name not in names:
            names.append(name)
    if not names:
        return ''
    head = ', '.join(names[:3])
    return head + (f' 외 {len(names) - 3}곳' if len(names) > 3 else '')


def build_urgent_message(sb, issues):
    """긴급(일정이 지금 썩고 있다)만 담는다. (제목, 본문) 또는 (None, None).

    ⚠️ 여기서는 절대 자르지 않는다. 예전 build_message는 owner_items[:8]로 잘랐는데,
       상세 이미지 유형 항목이 앞자리를 채우는 날엔 '크롤 3일째 실패'가 "... 외 N건 더"에
       묻혀 아예 안 보일 수 있었다. 이제 운영 과제는 다른 메일로 빠지므로 자를 이유도 없다.
    """
    # 꼬리표가 없으면 긴급으로 본다 — 새 점검을 추가하고 분류를 깜빡했을 때 조용히
    # 묻히는 것보다 시끄럽게 울리는 쪽이 안전하다. 걸러내는 책임을 호출부에 맡기지
    # 않고 여기서 한 번 더 본다(운영 과제가 긴급 메일에 섞이면 분리한 의미가 없다).
    errors = [i for i in issues
              if i['level'] == 'ERROR' and i.get('kind', URGENT_KIND) == URGENT_KIND]
    if not errors:
        return None, None

    now = datetime.now(timezone.utc)
    state = load_alert_state(sb, [_fingerprint(i) for i in errors])

    owner_items, auto_items = [], []
    escalated_days = 0.0
    for i in errors:
        fp = _fingerprint(i)
        note = _fingerprint_text(i)
        prev = state.get(fp)
        owner = _needs_owner(i)

        if owner:
            # 며칠째 방치된 건은 억제를 풀어 더 자주 알린다(3일 사고 재발 방지).
            days = _persisted_days(i, prev, now)
            escalated = days >= ESCALATE_AFTER_DAYS
            silence = ESCALATED_SILENCE_HOURS if escalated else i.get('silence_hours', REPEAT_SILENCE_HOURS)
            # 같은 내용을 최근에 보냈으면 조용히 넘긴다(반복 폭탄 방지).
            last_sent = prev and prev.get('last_sent_at')
            if last_sent:
                try:
                    gap_h = (now - datetime.fromisoformat(last_sent.replace('Z', '+00:00'))).total_seconds() / 3600
                except Exception:
                    gap_h = 999
                if gap_h < silence:
                    record_alert(sb, fp, prev, sent=False, note=note)
                    print(f'  (반복 억제) {i["msg"][:60]}')
                    continue
            if escalated:
                escalated_days = max(escalated_days, days)
            owner_items.append((fp, prev, i, note, days))
        else:
            # 자가복구: 짧은 시간에 반복될 때만 알린다.
            cnt = (prev.get('seen_count', 0) if prev else 0) + 1
            recent = False
            if prev and prev.get('first_seen_at'):
                try:
                    span_h = (now - datetime.fromisoformat(prev['first_seen_at'].replace('Z', '+00:00'))).total_seconds() / 3600
                    recent = span_h <= AUTO_ESCALATE_HOURS
                except Exception:
                    pass
            if cnt >= AUTO_ESCALATE_COUNT and recent:
                auto_items.append((fp, prev, i, note, 0.0))
            else:
                record_alert(sb, fp, prev, sent=False, note=note)
                print(f'  (자가복구, 알림 생략) {i["msg"][:60]}')

    if not owner_items and not auto_items:
        return None, None

    now_kst = now.astimezone().strftime('%m/%d %H:%M')
    label = _company_label(owner_items)
    if owner_items and escalated_days >= ESCALATE_AFTER_DAYS:
        subject = f'🚨 {int(escalated_days)}일째 방치 — {label or f"긴급 {len(owner_items)}건"}'
    elif owner_items:
        subject = f'🚨 긴급 {len(owner_items)}건 — {label}' if label else f'🚨 긴급 {len(owner_items)}건'
    else:
        subject = f'⚠️ 소개팅모아 워치독 — 자동조치가 반복됨 {len(auto_items)}건'

    lines = [f'소개팅모아 워치독 {now_kst}', '']
    if owner_items:
        lines.append(f'■ 지금 손봐야 합니다 {len(owner_items)}건 — 그동안 옛 일정이 앱에 그대로 노출됩니다')
        for _fp, _p, i, _n, days in owner_items:
            mark = f'[{int(days)}일째] ' if days >= ESCALATE_AFTER_DAYS else ''
            lines.append(f'  · {mark}{i["msg"]}')
        lines.append('')
    if auto_items:
        lines.append(f'■ 자동조치를 했는데 또 발생 {len(auto_items)}건 — 자동복구가 듣지 않습니다')
        for _fp, _p, i, _n, _d in auto_items[:5]:
            lines.append(_bullet(i))
        lines.append('')
    lines.append(f'같은 내용은 {REPEAT_SILENCE_HOURS}시간(방치 {ESCALATE_AFTER_DAYS}일 넘으면 {ESCALATED_SILENCE_HOURS}시간) 안에는 다시 보내지 않습니다.')
    lines.append('상세 이미지 유형 등 운영 과제는 이 메일에 넣지 않습니다 — 하루 1회 별도 요약으로 갑니다.')
    lines.append('스스로 되살린 지연도 넣지 않습니다(이 메일이 없으면 정상입니다).')
    lines.append('실행 이력: https://github.com/dailyhotcoolmeme/sodate/actions')

    for fp, prev, _i, note, _d in owner_items + auto_items:
        record_alert(sb, fp, prev, sent=True, note=note)

    return subject, '\n'.join(lines)


def build_ops_digest(sb, issues):
    """운영 과제(상세 이미지 유형·완성도·가격 정합성)를 하루 한 통으로 묶는다.

    개별 지문 억제 대신 요약 전체에 자물쇠 하나를 건다 — 프립·문토는 모임 제목이 매일
    바뀌어 개별 지문이 계속 새로 생기는 탓에 24시간 억제가 구조적으로 새고 있었다.
    """
    # 긴급이 여기 섞여 하루짜리 자물쇠에 갇히면 최악이다 — 명시적으로 배제한다.
    errors = [i for i in issues
              if i['level'] == 'ERROR' and i.get('kind', URGENT_KIND) != URGENT_KIND]
    if not errors:
        return None, None

    now = datetime.now(timezone.utc)
    prev = load_alert_state(sb, [OPS_DIGEST_FINGERPRINT]).get(OPS_DIGEST_FINGERPRINT)
    note = f'운영 과제 일간 요약({len(errors)}건)'
    last_sent = prev and prev.get('last_sent_at')
    if last_sent:
        try:
            gap_h = (now - datetime.fromisoformat(last_sent.replace('Z', '+00:00'))).total_seconds() / 3600
        except Exception:
            gap_h = 999
        if gap_h < OPS_DIGEST_SILENCE_HOURS:
            record_alert(sb, OPS_DIGEST_FINGERPRINT, prev, sent=False, note=note)
            print(f'  (일간 요약 억제) 운영 과제 {len(errors)}건')
            return None, None

    now_kst = now.astimezone().strftime('%m/%d')
    subject = f'📋 소개팅모아 일간 점검 — 운영 과제 {len(errors)}건'
    lines = [f'소개팅모아 운영 과제 요약 {now_kst}', '',
             '급한 장애가 아니라 시간 날 때 채워 넣을 것들입니다.',
             '진짜 장애는 이 메일이 아니라 🚨 제목의 긴급 메일로 따로 갑니다.', '']
    for i in errors[:OPS_DIGEST_MAX_LINES]:
        lines.append(_bullet(i))
    if len(errors) > OPS_DIGEST_MAX_LINES:
        lines.append(f'  ... 외 {len(errors) - OPS_DIGEST_MAX_LINES}건 더')
    lines.append('')
    lines.append(f'이 요약은 {OPS_DIGEST_SILENCE_HOURS}시간에 한 번만 갑니다.')
    lines.append('실행 이력: https://github.com/dailyhotcoolmeme/sodate/actions')

    record_alert(sb, OPS_DIGEST_FINGERPRINT, prev, sent=True, note=note)
    return subject, '\n'.join(lines)


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


def send_email(text: str, subject: str = '🚨 소개팅모아 워치독 — 문제 발견') -> None:
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
            'subject': subject,
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
                'company': comps.get(cid, cid),
                'msg': f"{comps.get(cid, cid)}: 최근 크롤이 0건인데 성공으로 기록됨 — 사이트 변경·파싱 깨짐 의심",
            })

    # ⚠️ 여기에 status='failed'를 함께 보지 않아 생긴 사고(2026-08-13 전수조사):
    #    워치독의 모든 점검이 'success'인 기록만 골라 보고 있었다. 그래서 크롤러가 아예
    #    실패하면 워치독에게는 아무것도 안 보였다. 모드파티가 8/4 마지막 성공 이후 9일간
    #    매 회차 실패했는데 알림이 한 번도 안 나갔고, 그동안 앞으로 일정 13건이 갱신 없이
    #    그대로 노출됐다. '조용히 낡아가는' 것을 잡자고 만든 점검이 정작 가장 시끄러운
    #    실패를 놓치고 있었다.
    issues += check_failing_crawls(sb, comps)
    return issues


# 며칠씩 이어지는 실패만 오너에게 알린다. 한 번 튄 건 다음 회차에 대개 복구된다.
FAIL_STREAK_HOURS = 24


def check_failing_crawls(sb, comps: dict) -> list[dict]:
    """연속으로 실패 중인 크롤러를 잡는다(마지막 성공 이후 경과 시간 기준)."""
    issues: list[dict] = []
    since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    try:
        logs = (
            sb.table('crawl_logs')
            .select('company_id,status,executed_at')
            .gte('executed_at', since)
            .order('executed_at', desc=True)
            .limit(2000)
            .execute()
        ).data or []
    except Exception as e:
        return [{'level': 'WARN', 'msg': f'실패 크롤 점검 실패({str(e)[:60]})'}]

    latest_any: dict = {}
    latest_ok: dict = {}
    for lg in logs:
        cid = lg['company_id']
        latest_any.setdefault(cid, lg)
        if lg.get('status') == 'success':
            latest_ok.setdefault(cid, lg)

    now = datetime.now(timezone.utc)
    for cid, lg in latest_any.items():
        if lg.get('status') == 'success':
            continue
        ok = latest_ok.get(cid)
        if ok:
            gap = now - datetime.fromisoformat(ok['executed_at'].replace('Z', '+00:00'))
            hours = int(gap.total_seconds() // 3600)
            if hours < FAIL_STREAK_HOURS:
                continue
            detail = f'마지막 성공이 {hours // 24}일 {hours % 24}시간 전'
            persisted = hours / 24
        else:
            detail = '최근 14일 내 성공 기록 없음'
            persisted = 14.0
        issues.append({
            'level': 'ERROR',
            'action': 'owner',
            'company': comps.get(cid, cid),
            # 방치 일수의 정본. 알림 이력(first_seen_at)은 지문이 바뀌면 리셋되므로 믿지 않는다.
            'persisted_days': persisted,
            'msg': f'{comps.get(cid, cid)}: 크롤이 계속 실패 중 — {detail}. '
                   f'그동안 이 업체 일정은 갱신되지 않고 그대로 노출됩니다(사이트 변경·로그인 만료 의심)',
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
            # 건수 급락은 '일정이 지금 썩고 있다'는 신호라 긴급으로 못박는다(같은 함수의
            # 마감률·가격 결측은 표시 품질 문제라 운영 과제로 남긴다).
            issues.append({
                'level': 'ERROR',
                'kind': URGENT_KIND,
                'company': comps.get(cid, cid),
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



# 상세 이미지 유형이 없는 '모임 세트'를 몇 건 이상일 때 알릴지(오너 확정 2026-07-30).
# 프립·문토는 잘게 나오는 세트가 많아 낮게 잡으면 메일이 잦아진다.
MISSING_TYPE_MIN_EVENTS = 5
# 한 번에 너무 많이 늘어놓지 않는다. 나머지는 건수만 알리고, 반복 억제(6시간)에
# 걸리지 않는 다음 점검에서 이어서 나온다.
MISSING_TYPE_MAX_LINES = 5


def check_missing_image_types(sb) -> list[dict]:
    """상세 이미지 유형이 없는 새 모임 세트를 찾는다.

    검색어(match_keywords)가 걸리는 모임은 새로 올라와도 이미지·해시태그가 자동으로
    붙는다. 문제는 처음 보는 모임 — 걸리는 유형이 없어 상세 설명이 통째로 안 나온다.
    오너가 업체별 화면을 열어보지 않으면 모르므로 여기서 알린다(2026-07-30 오너 요청).

    묶는 규칙은 admin(titleGroups.ts)과 같아야 한다 — 알림에 적힌 세트를 그 화면에서
    찾을 수 있어야 하기 때문. utils/title_groups.py 를 공유한다.
    """
    issues: list[dict] = []
    now = datetime.now(timezone.utc)
    try:
        companies = sb.table('companies').select('id,name').execute().data or []
    except Exception as e:
        return [{'level': 'WARN', 'msg': f'유형 없는 모임 점검 실패({str(e)[:60]})'}]

    found: list[tuple] = []  # (건수, 업체명, 문구, 대표제목)
    for c in companies:
        try:
            types = (
                sb.table('company_image_types')
                .select('match_keywords,images')
                .eq('company_id', c['id'])
                .execute()
            ).data or []
            kws = [
                str(k).strip().lower()
                for t in types if (t.get('images') or [])
                for k in (t.get('match_keywords') or []) if k and str(k).strip()
            ]
            ev = (
                sb.table('events')
                .select('title,source_url')
                .eq('company_id', c['id'])
                .eq('is_active', True)
                .gte('event_date', now.isoformat())
                .limit(2000)
                .execute()
            ).data or []
        except Exception:
            continue

        rows = [
            {'title': e['title'], 'url': e['source_url']}
            for e in ev
            if (e.get('title') or '').strip()
            and not any(k in e['title'].lower() for k in kws)
        ]
        if not rows:
            continue
        for g in suggest_groups(rows):
            if len(g['rows']) < MISSING_TYPE_MIN_EVENTS:
                continue
            found.append((len(g['rows']), c['name'], g['keyword'] or '', g['rep']))

    found.sort(key=lambda x: -x[0])
    for n, name, kw, rep in found[:MISSING_TYPE_MAX_LINES]:
        label = kw if kw else rep
        issues.append({
            'level': 'ERROR', 'company': name, 'action': 'owner',
            'silence_hours': MISSING_TYPE_SILENCE_HOURS,
            'msg': f'상세 이미지 유형이 없는 모임 {n}건 — 공통 문구 "{label[:40]}" '
                   f'(업체 관리 → 상세 이미지 관리 → 같은 모임끼리)',
        })
    if len(found) > MISSING_TYPE_MAX_LINES:
        issues.append({
            'level': 'ERROR', 'action': 'owner',
            'silence_hours': MISSING_TYPE_SILENCE_HOURS,
            'msg': f'상세 이미지 유형이 없는 세트가 {len(found)}개 더 있습니다'
                   f'(위 {MISSING_TYPE_MAX_LINES}개 외).',
        })
    return issues

def run() -> int:
    sb = get_supabase()

    print('[1/6] 하트비트(마지막 성공 실행 시각) 확인...')
    heartbeat_issues = _tag(check_heartbeats(), URGENT_KIND)

    print('[2/6] 완성도(가격+나이) 점검...')
    completeness_issues = _tag(check_completeness(sb), OPS_KIND)

    print('[3/6] price_detail 정합성 점검...')
    consistency_issues = _tag(check_field_consistency(sb), OPS_KIND)

    print('[4/6] 빈 크롤(0건인데 success)·연속 실패 점검...')
    empty_issues = _tag(check_empty_crawls(sb), URGENT_KIND)

    print('[5/6] 데이터 드리프트(건수 급락·마감률·가격 결측) 점검...')
    drift_issues = _tag(check_data_drift(sb), OPS_KIND)   # 건수 급락만 함수 안에서 urgent로 명시

    print('[6/6] 상세 이미지 유형 없는 모임 세트 점검...')
    missing_type_issues = _tag(check_missing_image_types(sb), OPS_KIND)

    all_issues = (heartbeat_issues + completeness_issues + consistency_issues
                  + empty_issues + drift_issues + missing_type_issues)
    errors = [i for i in all_issues if i['level'] == 'ERROR']
    print(f'\n총 {len(errors)}건 ERROR')
    for i in errors:
        print(f'  ✗ {i}')

    urgent = [i for i in all_issues if i.get('kind') == URGENT_KIND]
    ops = [i for i in all_issues if i.get('kind') != URGENT_KIND]
    print(f'  → 긴급 {len([i for i in urgent if i["level"] == "ERROR"])}건 / '
          f'운영 과제 {len([i for i in ops if i["level"] == "ERROR"])}건')

    sent = False

    def _send(subject: str, msg: str) -> None:
        # 둘 다 시도 — 하나 실패해도 다른 하나는 계속 보낸다(알림 자체가 감시자니까 여기도
        # "한 건 실패가 전체를 못 죽인다" 원칙 적용).
        try:
            send_email(msg, subject)
        except Exception as e:
            print(f'이메일 전송 실패: {e}')
        try:
            send_kakao(f'{subject}\n\n{msg}')
        except Exception as e:
            print(f'카카오 전송 실패: {e}')
        print(msg)

    # 긴급 먼저 — 운영 요약 쪽이 실패해도 이건 이미 나가 있어야 한다.
    u_subject, u_msg = build_urgent_message(sb, urgent)
    if u_msg:
        _send(u_subject, u_msg)
        sent = True

    o_subject, o_msg = build_ops_digest(sb, ops)
    if o_msg:
        _send(o_subject, o_msg)
        sent = True

    # 발견 건수와 '보냈는지'는 다르다 — 이미 알린 문제는 억제되므로 발견됐는데도
    # 메일이 안 나갈 수 있다. 로그에 사실대로 남긴다.
    return len(errors), sent


if __name__ == '__main__':
    # ⚠️ 문제를 '발견'한 것은 워치독이 제대로 돈 것이다 → 종료코드 0.
    #    예전엔 발견 시 1로 끝나서 GitHub이 "workflow failed" 메일을 따로 보냈고,
    #    내용도 없이 'failed'만 떠 워치독 자체가 고장난 것처럼 보였다(2026-07-29 오너
    #    지적: 하루 43회 중 7회가 failed로 표시). 실제 알림은 카카오·이메일로 이미 간다.
    #    실패(1)는 워치독이 죽었을 때만 — 그래야 'failed'가 진짜 신호가 된다.
    try:
        n, sent = run()
        if n:
            state = '알림 발송' if sent else '이미 알린 문제라 발송 생략'
            print(f'문제 {n}건 발견 — {state}(워치독 자체는 정상 동작)')
        sys.exit(0)
    except Exception as e:
        print(f'워치독 실행 실패: {e}')
        sys.exit(1)
