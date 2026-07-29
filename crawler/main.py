"""소개팅모아 크롤러 메인 실행 파일"""
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
]

# ⚠️(2026-07-24 오너 지적으로 폐기) discover_candidates.py 전담 방침이 있었으나
# 그 스크립트는 어떤 워크플로우에도 스케줄된 적이 없어(1회성 수동 실행뿐) 여기 있던
# 7개 업체가 17일 넘게 정기 크롤에서 완전히 빠진 채 방치됨(price_detail 유령필드와
# 동일 패턴). 정규 스크래퍼(main.py)는 정상 동작 확인됨 — base_scraper.py가 None
# 나이/가격을 upsert에서 걸러내 기존 값을 지우지 않으므로 되돌림 걱정 없이 재활성화.
DISCOVER_MANAGED: set[str] = set()


def run_all() -> int:
    """모든 스크래퍼 순차 실행. 전체 실패(성공 0개)일 때만 exit code 1 반환"""
    results = []
    disabled = get_disabled_slugs()
    for ScraperClass in SCRAPERS:
        try:
            scraper = ScraperClass()
        except Exception as e:
            logger.error(f"[{ScraperClass.__name__}] 초기화 실패 (Secrets 미설정 등): {e}")
            results.append({'company': ScraperClass.__name__, 'status': 'failed', 'error': str(e)})
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

    if success == 0:
        # 단 한 곳도 성공 못했을 때만 전체 실패 처리 (Secrets 미설정, 네트워크 불가 등)
        logger.error(f"전체 크롤링 실패 — 성공 0건. Secrets 및 네트워크 상태를 확인하세요.")
        return 1

    if failed > 0:
        # 일부 실패는 경고만 남기고 성공 처리 (개별 업체 사이트 문제)
        logger.warning(f"{failed}개 업체 크롤링 실패 (일부 실패 — 워크플로우는 계속 진행)")

    return 0


if __name__ == '__main__':
    exit_code = run_all()
    sys.exit(exit_code)
