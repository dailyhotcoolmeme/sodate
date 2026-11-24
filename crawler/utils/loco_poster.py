"""공식 로꼬 명단 이미지의 동일 줄 일시·지점만 두 OCR 결과로 대조한다."""
import io
import csv
from collections import Counter
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
from PIL import Image

LINE = re.compile(r'(\d{1,2})[./](\d{1,2})\s*\(([월화수목금토일])\)\s*(사당|수원)점\s*(\d{1,2})\s*:\s*(\d{2})\s*[-~–]\s*\d{1,2}\s*:\s*\d{2}')


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
    readings = [schedule_lines(text, now) for text in texts]
    votes = Counter(pair for reading in readings for pair in reading)
    # 적어도 두 분할 방식에서 일치해야 한다. 어느 방식이든 상충한 시각은 저장 금지.
    return {pair for pair, count in votes.items() if count >= 2 and len({dt
            for reading in readings for region, dt in reading
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
                if schedule_lines(texts[0], now) != schedule_lines(texts[1], now):
                    # 세로로 합친 명단에서 psm6가 상단 사당 블록만 놓치는 실측 회귀.
                    # 자동 문단 분할도 읽어 두 방식 이상 일치하는 회차만 복구한다.
                    third = subprocess.run(['tesseract', str(path), 'stdout', '-l', 'kor+eng',
                        '--psm', '3'], capture_output=True, check=True, timeout=35).stdout.decode('utf-8')
                    texts += (third,)
                    candidates = set().union(*(schedule_lines(t, now) for t in texts))
                    if candidates - agreed_schedule(texts, now):
                        # 긴 합성 이미지의 작은 상단 글씨를 각 방식으로 분할 재독한다.
                        # 타일 개수가 아니라 분할 방식별로 합쳐 한 표만 인정한다.
                        merged = list(texts)
                        for top in range(0, im.height, im.width):
                            bottom = min(im.height, top + im.width * 2)
                            if bottom - top < im.width:
                                continue
                            im.crop((0, top, im.width, bottom)).convert('RGB').save(path, format='PNG')
                            for index, mode in enumerate(('6', '4')):
                                tile = subprocess.run(['tesseract', str(path), 'stdout', '-l', 'kor+eng',
                                    '--psm', mode], capture_output=True, check=True, timeout=35).stdout.decode('utf-8')
                                merged[index] += '\n' + tile
                        texts = tuple(merged)
                        if candidates - agreed_schedule(texts, now):
                            # 실제 OCR 단어 좌표에서 시각이 있는 줄만 찾아 확대 문맥으로 재독.
                            # 위치는 데이터가 아닌 원본의 글자 좌표다. 지점/날짜/시각은 여전히
                            # 같은 줄에서 두 분할 방식이 모두 읽어야 한다.
                            im.convert('RGB').save(path, format='PNG')
                            tsv = subprocess.run(['tesseract', str(path), 'stdout', '-l', 'kor+eng',
                                '--psm', '4', 'tsv'], capture_output=True, check=True, timeout=35).stdout.decode('utf-8')
                            rows = list(csv.DictReader(io.StringIO(tsv), delimiter='\t'))
                            padding = max(20, im.width // 25)
                            bands = []
                            for row in rows:
                                if not re.search(r'\d{1,2}\s*:\s*\d{2}', row.get('text', '')):
                                    continue
                                top, height = int(row['top']), int(row['height'])
                                if not any(abs(top - previous[0]) < padding for previous in bands):
                                    bands.append((top, height))
                            for top, height in bands[:12]:
                                im.crop((0, max(0, top-padding), im.width,
                                         min(im.height, top+height+padding))).convert('RGB').save(path, format='PNG')
                                for index, mode in enumerate(('6', '4')):
                                    band = subprocess.run(['tesseract', str(path), 'stdout', '-l', 'kor+eng',
                                        '--psm', mode], capture_output=True, check=True, timeout=35).stdout.decode('utf-8')
                                    merged[index] += '\n' + band
                            texts = tuple(merged)
            compact = tuple(re.sub(r'\s+', '', text) for text in texts)
            headers = tuple('와인파티' in text and '실시간' in text for text in compact)
            agreed = agreed_schedule(texts, now)
            logger.info('로꼬 OCR 대조: file=%s header_raw=%s header_compact=%s dates=%s agreed=%s',
                        Path(urlparse(url).path).name,
                        tuple('와인파티' in t and '실시간' in t for t in texts), headers,
                        tuple(len(schedule_lines(t, now)) for t in texts),
                        sorted((venue, dt.isoformat()) for venue, dt in agreed))
            if sum(headers) >= 2:
                result.update(agreed)
        except Exception as error:
            logger.warning('로꼬 명단 OCR 실패: %s', type(error).__name__)
    return result
