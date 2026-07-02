from datetime import datetime, timedelta, timezone

# base_scraper.save_events가 naive datetime을 KST로 간주하므로 동일 기준으로 통일한다.
KST = timezone(timedelta(hours=9))


def is_within_one_month(event_date: datetime) -> bool:
    """오늘 ~ 오늘+31일 범위인지 확인"""
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=31)
    # naive datetime은 KST로 간주 (save_events와 동일 기준 — 경계일 9h 어긋남 방지)
    if event_date.tzinfo is None:
        event_date = event_date.replace(tzinfo=KST)
    return now <= event_date <= cutoff
