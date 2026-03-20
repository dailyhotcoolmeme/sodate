"""후기 크롤러 통합 실행"""
import sys
from dotenv import load_dotenv

load_dotenv()

from scrapers.review_naver import run_review_crawl as run_naver
from scrapers.review_instagram import run_instagram_crawl as run_instagram
from utils.logger import get_logger

logger = get_logger('reviews_main')


def run_all():
    logger.info('=== 후기 크롤링 시작 ===')

    logger.info('[1/2] 네이버 블로그 후기 크롤링')
    try:
        run_naver()
    except Exception as e:
        logger.error(f'네이버 후기 크롤링 실패: {e}')

    logger.info('[2/2] 인스타그램 후기 크롤링')
    try:
        run_instagram()
    except Exception as e:
        logger.error(f'인스타그램 후기 크롤링 실패: {e}')

    logger.info('=== 후기 크롤링 완료 ===')


if __name__ == '__main__':
    run_all()
