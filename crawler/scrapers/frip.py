"""프립 (frip.co.kr) 스크래퍼 — GraphQL API 기반"""
import re
from datetime import datetime, timezone
from typing import Optional

import httpx

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text

FRIP_GQL = 'https://gql.frip.co.kr/graphql'
FRIP_BASE = 'https://frip.co.kr'

# 소셜/소개팅모임 카테고리 ID
CATEGORY_IDS = [2841]

PRICE_RE = re.compile(r'[\d.]+')
REGION_KW = ['강남', '서초', '홍대', '신촌', '잠실', '건대', '성수', '이태원', '합정', '여의도',
             '마포', '종로', '용산', '동작', '관악', '수원', '인천', '부산', '대구', '대전']

GQL_QUERY = '''
query ProductContainer($filter: ListingProductFilterV4, $size: Int, $page: Int) {
  product {
    listingProductsV4(size: $size, page: $page, filter: $filter) {
      pageInfo { hasNextPage }
      totalCount
      edges {
        node {
          id
          title
          areaName
          salePrice
          scheduleFirstDate
          headerContents {
            content {
              thumbnail(width: 500, height: 500, crop: FILL, fetchFormat: AUTO)
            }
          }
        }
      }
    }
  }
}
'''

GQL_HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Origin': 'https://frip.co.kr',
    'Referer': 'https://frip.co.kr/',
}


class FripScraper(BaseScraper):
    def __init__(self):
        super().__init__('frip')

    def scrape(self) -> list[EventModel]:
        events = []
        try:
            nodes = self._fetch_all_products()
            self.logger.info(f'프립 상품 {len(nodes)}개 수집')
            for node in nodes:
                ev = self._node_to_event(node)
                if ev:
                    events.append(ev)
        except Exception as e:
            self.logger.error(f'프립 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [ev for ev in events if ev.source_url not in seen and not seen.add(ev.source_url)]  # type: ignore
        self.logger.info(f'프립 총 {len(unique)}개 이벤트')
        return unique

    def _fetch_all_products(self) -> list[dict]:
        nodes: list[dict] = []
        page = 1
        with httpx.Client(timeout=20) as client:
            while True:
                variables = {
                    'filter': {'categoryIds': CATEGORY_IDS, 'orderType': 'LATEST'},
                    'size': 24,
                    'page': page,
                }
                resp = client.post(
                    FRIP_GQL,
                    json={'operationName': 'ProductContainer', 'query': GQL_QUERY, 'variables': variables},
                    headers=GQL_HEADERS,
                )
                resp.raise_for_status()
                data = resp.json()
                lp = data['data']['product']['listingProductsV4']
                nodes.extend(e['node'] for e in lp['edges'])
                if not lp['pageInfo']['hasNextPage']:
                    break
                page += 1
        return nodes

    def _node_to_event(self, node: dict) -> Optional[EventModel]:
        try:
            ts = node.get('scheduleFirstDate')
            if not ts:
                return None

            event_date = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc)
            if event_date < datetime.now(timezone.utc):
                return None

            title = node.get('title') or ''
            if not any(kw in title for kw in ['소개팅', '미팅', '로테이션', '파티', '번개', '썸', '솔로']):
                return None

            area = node.get('areaName') or ''
            region = '서울'
            for kw in REGION_KW:
                if kw in area or kw in title:
                    region = kw
                    break

            sale_price = node.get('salePrice')
            price: Optional[int] = None
            if sale_price:
                try:
                    price = int(float(str(sale_price)))
                except (ValueError, TypeError):
                    pass

            product_id = node.get('id')
            source_url = f'{FRIP_BASE}/products/{product_id}#evt={event_date.strftime("%Y%m%d%H%M")}'

            # 썸네일
            thumbnails: list[str] = []
            for hc in node.get('headerContents') or []:
                thumb = (hc.get('content') or {}).get('thumbnail')
                if thumb:
                    thumbnails.append(thumb)
                    break

            theme = ['일반']
            if '와인' in title:
                theme = ['와인']
            elif '쿠킹' in title or '요리' in title:
                theme = ['쿠킹']

            return EventModel(
                title=sanitize_text(f'[프립] {title}', 80),
                event_date=event_date,
                location_region=region,
                location_detail=area or None,
                price_male=price,
                price_female=price,
                gender_ratio=None,
                source_url=source_url,
                thumbnail_urls=thumbnails,
                theme=theme,
                seats_left_male=None,
                seats_left_female=None,
            )
        except Exception as e:
            self.logger.warning(f'프립 노드 파싱 실패: {e}')
            return None
