"""모잇(sodate) 크롤러 메인 실행 파일"""
import sys
from dotenv import load_dotenv

load_dotenv()

from utils.supabase_client import get_supabase


def get_disabled_slugs() -> set:
    """companies.crawl_enabled=false 인 업체 slug 집합.
    휴면·수동전용 업체를 삭제 대신 이 플래그로 스킵(등록은 유지 → slug 중복 방지)."""
    try:
        r = get_supabase().table('companies').select('slug').eq('crawl_enabled', False).execute()
        return {c['slug'] for c in (r.data or [])}
    except Exception:
        return set()

from scrapers.yeonin import YeoninScraper
from scrapers.emotional_orange import EmotionalOrangeScraper
from scrapers.frip import FripScraper
from scrapers.munto import MuntoScraper
from scrapers.modparty import ModpartyScraper
from scrapers.talkblossom import TalkblossomScraper
from scrapers.lovecasting import LovecastingScraper
from scrapers.yeongyul import YeongyulScraper
from scrapers.twoyeonsi import TwoYeonsiScraper
from scrapers.secretsalon import SecretSalonScraper
from scrapers.lovecommunity import LovecommunityLoco
from scrapers.finance_lounge import FinanceLoungeScraper
from scrapers.otr_lounge import OtrLoungeScraper
from scrapers.unibridge_social import UnibridgeSocialScraper
from scrapers.trevari import TrevariScraper
from scrapers.donghaeng import DonghaengScraper
from scrapers.yeonsoop import YeonsoopScraper
from utils.logger import get_logger

logger = get_logger('main')

SCRAPERS = [
    YeoninScraper,
    EmotionalOrangeScraper,
    FripScraper,
    MuntoScraper,
    ModpartyScraper,
    TalkblossomScraper,
    LovecastingScraper,
    YeongyulScraper,
    TwoYeonsiScraper,
    SecretSalonScraper,
    LovecommunityLoco,
    FinanceLoungeScraper,
    OtrLoungeScraper,
    UnibridgeSocialScraper,
    # 소셜링 신규 소스(2026-08-21) — event_type='socialing'. 소개팅 피드엔 안 섞임.
    TrevariScraper,
    DonghaengScraper,
    # 연숲(2026-09-01, 제휴 문의로 합류) — 웹사이트가 없어 인스타 캡션을 파싱한다.
    # 소개팅·소셜링을 둘 다 열어서 게시물마다 event_type 을 갈라 넣는다.
    YeonsoopScraper,
]

# ⚠️(2026-07-24 오너 지적으로 폐기) discover_candidates.py 전담 방침이 있었으나
# 그 스크립트는 어떤 워크플로우에도 스케줄된 적이 없어(1회성 수동 실행뿐) 여기 있던
# 7개 업체가 17일 넘게 정기 크롤에서 완전히 빠진 채 방치됨(price_detail 유령필드와
# 동일 패턴). 정규 스크래퍼(main.py)는 정상 동작 확인됨 — base_scraper.py가 None
# 나이/가격을 upsert에서 걸러내 기존 값을 지우지 않으므로 되돌림 걱정 없이 재활성화.
DISCOVER_MANAGED: set[str] = set()

# ─────────────────────────────────────────────────────────────────────────────
# 실행 그룹 — 한 줄로 다 돌리면 45분 한도를 못 지킨다(2026-09-04).
#
# 업체가 3곳일 때 짠 순차 실행을 17곳이 될 때까지 그대로 뒀다. 문토(1,400여 모임)가
# 34분, 프립(810건)이 10분을 쓰면서 그 뒤 순서 13곳은 시간이 없어 아예 못 돌았다.
# 최근 200회 실행이 전부 45분 타임아웃으로 취소됐고 성공이 한 번도 없었다.
# 로꼬가 8/31 이후 갱신이 끊겨 오류 제목·빈 사진이 앱에 그대로 남았던 게 이것 때문이다.
#
# 그래서 워크플로우에서 그룹별로 **동시에** 돌린다. 총 작업량은 같고 벽시계 시간만 준다.
# 새 스크래퍼를 SCRAPERS 에 추가하면 자동으로 'rest' 에 들어간다 — 굶는 업체가
# 다시 생기지 않게 하려면 여기 어느 그룹에도 안 적는 것이 정상이다.
GROUPS: dict[str, set[str]] = {
    'munto': {'munto'},
    'frip': {'frip'},
}
_GROUPED = {slug for slugs in GROUPS.values() for slug in slugs}


def _in_group(slug: str, group: str) -> bool:
    """group='all'이면 전부. 'rest'는 GROUPS 어디에도 없는 업체."""
    if group == 'all':
        return True
    if group == 'rest':
        return slug not in _GROUPED
    return slug in GROUPS.get(group, set())


def run_all(group: str = 'all') -> int:
    """스크래퍼 순차 실행. 전체 실패(성공 0개)일 때만 exit code 1 반환"""
    results = []
    disabled = get_disabled_slugs()
    if group != 'all':
        logger.info(f"실행 그룹: {group}")
    for ScraperClass in SCRAPERS:
        try:
            scraper = ScraperClass()
        except Exception as e:
            logger.error(f"[{ScraperClass.__name__}] 초기화 실패 (Secrets 미설정 등): {e}")
            results.append({'company': ScraperClass.__name__, 'status': 'failed', 'error': str(e)})
            continue
        # 이번 실행 그룹이 아닌 업체는 스킵(다른 잡이 같은 시각에 맡아 돈다)
        if not _in_group(scraper.company_slug, group):
            continue
        # 크롤링 금지(휴면·수동전용) 업체는 스킵
        if scraper.company_slug in disabled:
            logger.info(f"[{scraper.company_slug}] 크롤링 금지(crawl_enabled=false) — 스킵")
            continue
        # discover_candidates 전담 업체는 옛 스크래퍼가 건드리면 되돌림 → 스킵
        if scraper.company_slug in DISCOVER_MANAGED:
            logger.info(f"[{scraper.company_slug}] discover 전담(main.py 스킵 — 되돌림 방지)")
            continue
        result = scraper.run()
        results.append({
            'company': scraper.company_slug,
            **result,
        })

    success = sum(1 for r in results if r['status'] == 'success')
    failed = sum(1 for r in results if r['status'] == 'failed')

    logger.info(f"=== 전체 크롤링 완료 — 성공: {success}, 실패: {failed} ===")
    for r in results:
        status_icon = '✓' if r['status'] == 'success' else '✗'
        logger.info(
            f"  {status_icon} {r['company']}: "
            f"신규 {r.get('new', 0)}건 / "
            f"업데이트 {r.get('updated', 0)}건"
            + (f" / 오류: {r.get('error', '')}" if r['status'] == 'failed' else '')
        )

    if not results:
        # 그룹의 업체가 전부 crawl_enabled=false 인 경우 — 실패가 아니다.
        logger.info(f"실행 대상 업체가 없다(그룹 {group}) — 정상 종료")
        return 0

    if success == 0:
        # 단 한 곳도 성공 못했을 때만 전체 실패 처리 (Secrets 미설정, 네트워크 불가 등)
        logger.error(f"전체 크롤링 실패 — 성공 0건. Secrets 및 네트워크 상태를 확인하세요.")
        return 1

    if failed > 0:
        # 일부 실패는 경고만 남기고 성공 처리 (개별 업체 사이트 문제)
        logger.warning(f"{failed}개 업체 크롤링 실패 (일부 실패 — 워크플로우는 계속 진행)")

    return 0


if __name__ == '__main__':
    # 인자 없으면 전부(수동 실행·기존 호출부 호환). --group munto|frip|rest|all
    # ⚠️ 여기서 인자를 놓치면 조용히 '전체 실행'으로 떨어진다 — 세 그룹이 저마다 17곳을
    #    다 도는 꼴이 되니(중복 크롤·전송량 낭비) 공백 형태도 반드시 잡는다.
    args = sys.argv[1:]
    grp = 'all'
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith('--group='):
            grp = a.split('=', 1)[1]
        elif a == '--group':
            if i + 1 >= len(args):
                logger.error('--group 뒤에 그룹 이름이 없다')
                sys.exit(2)
            grp = args[i + 1]
            i += 1
        else:
            logger.error(f'모르는 인자: {a}')
            sys.exit(2)
        i += 1
    if grp not in ('all', 'rest', *GROUPS):
        logger.error(f"모르는 그룹: {grp} (가능: all, rest, {', '.join(GROUPS)})")
        sys.exit(2)
    sys.exit(run_all(grp))
