"""공식 로꼬 명단 이미지의 동일 줄 일시·지점만 두 OCR 결과로 대조한다."""
import io
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
from PIL import Image

LINE = re.compile(r'(\d{1,2})[./](\d{1,2})\s*\(([월화수목금토일])\)\s*(사당|수원)점\s*(\d{1,2}):(\d{2})\s*[-~–]\s*\d{1,2}:\d{2}')


def schedule_lines(text, now):
    found = set()
    for line in text.splitlines():
        m = LINE.search(line)
        if not m:
            continue
        month, day, weekday, region, hour, minute = m.groups()
        try:
            dt = datetime(now.year + (int(month) < now.month), int(month), int(day), int(hour), int(minute))
        except ValueError:
            continue
        if dt < now or (dt - now).days > 31 or dt.hour < 10:
            continue
        if '월화수목금토일'[dt.weekday()] != weekday:
            continue
        found.add((region, dt))
    return found


def agreed_schedule(texts, now):
    first, second = (schedule_lines(t, now) for t in texts)
    # 다른 방식이 같은 날짜/지점의 상충 시각을 읽었으면 그 회차는 제외한다
    return {pair for pair in first & second if len({dt for region, dt in first | second
            if region == pair[0] and dt.date() == pair[1].date()}) == 1}


def read_roster_schedules(soup, now, logger):
    if not shutil.which('tesseract'):
        logger.warning('로꼬 명단 OCR 미설치 — 시각 추정 없이 본문만 사용')
        return set()
    result = set()
    urls = {im.get('src', '') for im in soup.select('.fr-view img')}
    for url in urls:
        if urlparse(url).hostname not in ('cdn.imweb.me', 'cdn-optimized.imweb.me'):
            continue
        try:
            response = httpx.get(url, timeout=15)
            response.raise_for_status()
            if len(response.content) > 15_000_000:
                continue
            im = Image.open(io.BytesIO(response.content))
            # 현재 공식 명단은 4회차를 세로로 배치한다. 작은 달력·긴 안내 이미지는 제외
            if not (800 <= im.width <= 2000 and 2 <= im.height / im.width <= 7):
                continue
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory).resolve() / 'roster.png'
                im.convert('RGB').save(path, format='PNG')
                texts = tuple(subprocess.run(['tesseract', str(path), 'stdout', '-l', 'kor+eng',
                    '--psm', mode], capture_output=True, check=True, timeout=35).stdout.decode('utf-8')
                    for mode in ('6', '4'))
            compact = tuple(re.sub(r'\s+', '', text) for text in texts)
            headers = tuple('와인파티' in text and '실시간' in text for text in compact)
            agreed = agreed_schedule(texts, now)
            logger.info('로꼬 OCR 대조: file=%s header_raw=%s header_compact=%s dates=%s agreed=%s',
                        Path(urlparse(url).path).name,
                        tuple('와인파티' in t and '실시간' in t for t in texts), headers,
                        tuple(len(schedule_lines(t, now)) for t in texts),
                        sorted((venue, dt.isoformat()) for venue, dt in agreed))
            if all(headers):
                result.update(agreed)
        except Exception as error:
            logger.warning('로꼬 명단 OCR 실패: %s', type(error).__name__)
    return result
