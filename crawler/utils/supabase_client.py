import os
import time
import logging
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger('supabase')

# ⚠️ 2026-09-13. Supabase 가 가끔(하루 몇 번) 'Gateway Timeout' 같은 일시적 오류를
#    돌려준다. 그 한 번에 «작업 전체»가 죽었다 — 워치독 실패율 9%, 비imweb 새로고침 5%.
#    깃허브가 그때마다 실패 메일을 보내 오너가 계속 받았다.
#    자료가 잘못될 일은 없고 그저 잠깐 못 받은 것이므로, 여기서 몇 번 다시 시도한다.
#    이 파일의 get_supabase() 를 크롤러 전체가 쓰므로 한 곳만 고치면 전부 적용된다.
_MAX_TRIES = 4
_BACKOFF = (1, 3, 7)   # 초. 마지막 시도 뒤에는 안 기다린다.

# ⚠️ «다시 시도할 오류»를 나열하는 방식은 새 오류가 나올 때마다 또 뚫린다.
#    실제로 'Gateway Timeout' 만 넣었다가 <ConnectionTerminated ...> 에 그대로 죽었다.
#    그래서 반대로 «다시 시도해도 소용없는 것»만 골라내고 나머지는 전부 다시 시도한다.
#    소용없는 것 = 요청 자체가 틀린 경우. PostgREST 는 그럴 때 code 를 준다
#    (PGRST### / 42### / 23### …). 그런 응답은 즉시 실패시켜 진짜 버그를 숨기지 않는다.
_PERMANENT_HINTS = (
    'permission denied',
    'violates',              # 제약 위반
    'duplicate key',
    'invalid input syntax',
    'does not exist',
    'could not find',
)


def _is_transient(err: Exception) -> bool:
    """«잠깐 못 받은 것»인가. 요청 자체가 틀린 오류는 다시 시도해도 소용없다."""
    # PostgREST 가 code 를 준다 = 서버가 요청을 «이해하고» 거절한 것 → 영구 오류.
    code = None
    if isinstance(getattr(err, 'json', None), dict):
        code = err.json.get('code')
    for attr in ('code',):
        code = code or getattr(err, attr, None)
    if isinstance(err, dict):
        code = code or err.get('code')
    if code:
        return False

    low = (str(getattr(err, 'message', '') or '') + ' ' + str(err)).lower()
    if any(k in low for k in _PERMANENT_HINTS):
        return False
    return True


def _wrap_execute(cls) -> None:
    """postgrest 요청 객체의 execute() 를 «실패하면 잠시 뒤 다시»로 감싼다."""
    original = cls.execute
    if getattr(original, '_retry_wrapped', False):
        return

    def execute(self, *args, **kwargs):
        last = None
        for attempt in range(_MAX_TRIES):
            try:
                return original(self, *args, **kwargs)
            except Exception as e:  # noqa: BLE001 — 종류를 가려 아래에서 다시 던진다
                if not _is_transient(e) or attempt == _MAX_TRIES - 1:
                    raise
                last = e
                wait = _BACKOFF[min(attempt, len(_BACKOFF) - 1)]
                logger.warning(
                    'Supabase 일시 오류 — %s초 뒤 다시 시도 (%d/%d): %s',
                    wait, attempt + 1, _MAX_TRIES - 1, str(e)[:90],
                )
                time.sleep(wait)
        raise last  # 여기 오지 않는다(위에서 raise 됨). 형식상 남겨 둔다.

    execute._retry_wrapped = True  # type: ignore[attr-defined]
    cls.execute = execute


def _install_retry() -> None:
    try:
        from postgrest._sync import request_builder as rb
    except Exception as e:  # postgrest 구조가 바뀌면 재시도 없이 그냥 동작한다
        logger.warning('Supabase 재시도 설치 실패(계속 진행): %s', str(e)[:80])
        return
    for name in dir(rb):
        cls = getattr(rb, name, None)
        if isinstance(cls, type) and hasattr(cls, 'execute'):
            _wrap_execute(cls)


_install_retry()


def get_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수 필요")
    return create_client(url, key)
