from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional


class EventModel(BaseModel):
    external_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    thumbnail_urls: list[str] = []
    event_date: datetime
    location_region: str
    location_detail: Optional[str] = None
    price_male: Optional[int] = None
    price_female: Optional[int] = None
    gender_ratio: Optional[str] = None
    capacity_male: Optional[int] = None
    capacity_female: Optional[int] = None
    seats_left_male: Optional[int] = None
    seats_left_female: Optional[int] = None
    theme: list[str] = []
    hashtags: list[str] = []                     # 자동 생성 해시태그 (admin 검수·수정)
    age_range_min: Optional[int] = None
    age_range_max: Optional[int] = None
    age_male: Optional[str] = None              # 남성 나이 표시(예 '26~36'/'2030')
    age_female: Optional[str] = None            # 여성 나이 표시(성별 다르면 남과 다름)
    format: Optional[str] = None
    age_group_label: Optional[str] = None      # 나이대 그룹 라벨
    participant_stats: Optional[dict] = None    # 참가자 현황 JSON
    # 성별·티어별 가격 상세 {'male': {'regular': 48000, 'regular_soldout': True}, ...}
    # 앱이 품절 항목에 취소선을 긋는 데 쓴다. 옵션에서 정확히 뽑는 스크래퍼만 채운다.
    price_detail: Optional[dict] = None
    source_url: str
    is_closed: bool = False
    attendee_image_url: Optional[str] = None    # 참석자 명단 이미지(R2 재호스팅된 공개 URL)
    # 소셜링 확장(2026-08-21) — 앱 탭이 이걸로 나뉜다. 기본은 소개팅(dating).
    #   event_type='socialing' 이면 base_scraper 가 소개팅 전제(theme 고정·시간대 필터)를 우회한다.
    #   socialing_category 는 소셜링일 때만 채움(문화·예술/독서·성장/러닝 등) → 앱 필터 칩.
    event_type: str = 'dating'
    socialing_category: Optional[str] = None

    @field_validator('thumbnail_urls')
    @classmethod
    def limit_thumbnails(cls, v):
        return v[:5]  # 최대 5개

    @field_validator('location_region')
    @classmethod
    def normalize_region(cls, v):
        region_map = {
            '강남구': '강남', '역삼동': '역삼', '선릉': '선릉',
            '마포': '홍대', '홍익': '홍대', '연남': '연남',
            '수원시': '수원', '분당': '분당',
        }
        for key, normalized in region_map.items():
            if key in v:
                return normalized
        return v
