"""소개팅모아 크롤러 메인 실행 파일"""
import sys
from dotenv import load_dotenv

load_dotenv()

from scrapers.lovematching import LoveMatchingScraper
from scrapers.yeonin import YeoninScraper
from scrapers.emotional_orange import EmotionalOrangeScraper
# from scrapers.frip import FripScraper       # P2 — API 분석 후 활성화
# from scrapers.munto import MuntoScraper     # P2 — Playwright 구현 후 활성화
from utils.logger import get_logger

logger = get_logger('main')

# P1 스크래퍼 목록
SCRAPERS = [
    LoveMatchingScraper,
    YeoninScraper,
    EmotionalOrangeScraper,
]


def run_all() -> int:
    """모든 스크래퍼 순차 실행 후 실패 시 exit code 1 반환"""
    results = []
    for ScraperClass in SCRAPERS:
        scraper = ScraperClass()
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

    if failed > 0:
        logger.warning(f"{failed}개 업체 크롤링 실패 — GitHub Actions에서 실패로 처리됩니다")
        return 1
    return 0


if __name__ == '__main__':
    exit_code = run_all()
    sys.exit(exit_code)
