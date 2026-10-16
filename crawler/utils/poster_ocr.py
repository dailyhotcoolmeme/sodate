"""인스타 포스터의 무료 로컬 OCR. 외부 AI/유료 OCR API는 사용하지 않는다."""
import hashlib
import io
import subprocess
from urllib.parse import urlsplit

import httpx
from PIL import Image, ImageOps


class PosterOCR:
    def __init__(self):
        self.cache = {}
        self.urls = {}
        self.attempts = 0

    def read(self, url: str) -> tuple[str, str]:
        if url in self.urls:
            return self.urls[url]
        if self.attempts >= 80:
            raise ValueError('한 회차 포스터 판독 상한 초과')
        self.attempts += 1
        host = (urlsplit(url).hostname or '').lower()
        if not url.startswith('https://') or not any(
            host == suffix or host.endswith('.' + suffix)
            for suffix in ('cdninstagram.com', 'fbcdn.net')
        ):
            raise ValueError('공식 인스타 이미지 CDN이 아닌 주소')
        # 리다이렉트를 따라 사설망/다른 업체로 요청하지 않는다.
        with httpx.stream('GET', url, timeout=25, follow_redirects=False) as response:
            response.raise_for_status()
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 12 * 1024 * 1024:
                    raise ValueError('포스터 용량 초과')
        key = hashlib.sha256(body).hexdigest()
        if key in self.cache:
            self.urls[url] = self.cache[key]
            return self.cache[key]
        with Image.open(io.BytesIO(body)) as original:
            if original.width * original.height > 16_000_000:
                raise ValueError('포스터 해상도 초과')
            image = ImageOps.autocontrast(original.convert('L'))
            # 작은 글씨의 '원'이 축소 시 다른 문자로 읽힌 실측이 있어 원본 해상도 유지.
            buffer = io.BytesIO()
            image.save(buffer, format='PNG')
        texts = []
        for mode in ('6', '4'):
            result = subprocess.run(
                ['tesseract', 'stdin', 'stdout', '-l', 'kor+eng', '--psm', mode],
                input=buffer.getvalue(), capture_output=True, timeout=30, check=True,
            )
            texts.append(result.stdout.decode('utf-8'))
        self.cache[key] = tuple(texts)
        self.urls[url] = self.cache[key]
        return self.cache[key]
