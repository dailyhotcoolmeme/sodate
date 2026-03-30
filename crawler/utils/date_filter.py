from datetime import datetime, timedelta, timezone


def is_within_one_month(event_date: datetime) -> bool:
    """오늘 ~ 오늘+31일 범위인지 확인"""
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=31)
    # naive datetime은 UTC로 간주
    if event_date.tzinfo is None:
        event_date = event_date.replace(tzinfo=timezone.utc)
    return now <= event_date <= cutoff
