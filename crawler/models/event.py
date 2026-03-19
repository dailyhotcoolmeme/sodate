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
    age_range_min: Optional[int] = None
    age_range_max: Optional[int] = None
    format: Optional[str] = None
    source_url: str
    is_closed: bool = False

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
