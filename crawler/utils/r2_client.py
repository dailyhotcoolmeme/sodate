"""R2(S3 호환) 업로드/삭제 유틸. Supabase Storage 대신 R2를 쓰는 이유는
feedback_media_storage_r2_only 참고(이그레스 비용). admin이 이미 같은 버킷을
detail/{slug}/{typeId}/{uuid}.ext 키로 쓰고 있으므로, 이 유틸이 만드는 키도
같은 버킷·같은 공개서빙 라우트(admin/functions/media/[[path]].ts)를 그대로 탄다."""
import os
import boto3
from typing import Optional

from utils.logger import get_logger

logger = get_logger('r2_client')

PUBLIC_MEDIA_BASE = 'https://sodate-admin.pages.dev'


def _client():
    return boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        region_name='auto',
    )


def upload_bytes(key: str, data: bytes, content_type: str = 'image/png') -> str:
    """R2에 업로드하고 공개 URL을 반환한다. 실패하면 예외를 그대로 던진다
    (호출부에서 실패를 조용히 삼키지 말 것 — 이미지 없이 일정만 저장되는 게 나음)."""
    bucket = os.environ['R2_BUCKET']
    s3 = _client()
    s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
    return f'{PUBLIC_MEDIA_BASE}/media/{key}'


def object_exists(key: str) -> bool:
    """이미 올라가 있는 키인지 확인한다(썸네일 재호스팅에서 재업로드를 피하려고 씀).
    권한 문제 등 '없다'와 구분해야 하는 오류는 그대로 던진다 — 조용히 False 를 돌려주면
    매 크롤마다 같은 이미지를 다시 받아 올리게 된다."""
    bucket = os.environ['R2_BUCKET']
    try:
        _client().head_object(Bucket=bucket, Key=key)
        return True
    except Exception as e:
        code = getattr(e, 'response', {}).get('Error', {}).get('Code', '')
        if code in ('404', 'NoSuchKey', 'NotFound'):
            return False
        raise


def delete_by_public_url(url: Optional[str]) -> bool:
    """attendee_image_url에 저장된 공개 URL로부터 R2 키를 역산해 원본을 지운다.
    URL 형식이 아니거나(다른 소스) 이미 지워졌으면 조용히 False."""
    if not url or not url.startswith(f'{PUBLIC_MEDIA_BASE}/media/'):
        return False
    key = url[len(f'{PUBLIC_MEDIA_BASE}/media/'):]
    if not key:
        return False
    bucket = os.environ['R2_BUCKET']
    try:
        _client().delete_object(Bucket=bucket, Key=key)
        return True
    except Exception as e:
        logger.warning(f'R2 삭제 실패(스킵) {key}: {e}')
        return False
