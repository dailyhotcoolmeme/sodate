import { supabase } from '@/lib/supabase'
import { getOrCreateToken } from '@/lib/reviewIdentity'

/**
 * 게시판 동영상 첨부(숨김 기능). 모바일 최적 압축 → R2 단일 presigned PUT.
 * ⚠️ react-native-compressor·expo-video 는 네이티브 → 재빌드 후에만 동작.
 * VIDEO_ENABLED=false 라 버튼이 숨겨져 이 함수는 현재 앱에선 호출되지 않는다(sim 안전).
 * 라이브러리는 함수 안에서 lazy require — 모듈 로드 시 크래시 방지.
 */
export const VIDEO_ENABLED = false            // 재빌드 + 오너 승인 후 true 로.
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024   // 압축 후 상한(용량 기준, 길이 제한 없음)

async function presign(ext: string): Promise<{ uploadUrl: string; publicUrl: string } | { error: string }> {
  const ownerToken = await getOrCreateToken()
  const { data, error } = await supabase.functions.invoke('board', {
    body: { action: 'videoUploadUrl', ownerToken, ext },
  })
  if (error || !data?.uploadUrl) return { error: '업로드 준비에 실패했어요.' }
  return { uploadUrl: data.uploadUrl, publicUrl: data.publicUrl }
}

/** 갤러리에서 영상 선택 → 모바일 최적 압축 → R2 업로드 → 공개 URL. */
export async function pickCompressUploadVideo(
  onProgress?: (p: number) => void,
): Promise<{ url: string } | { error: string } | null> {
  const ImagePicker = require('expo-image-picker')
  const { Video } = require('react-native-compressor')

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) return { error: '동영상을 첨부하려면 사진첩 접근 권한이 필요해요.' }

  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 })
  if (picked.canceled || !picked.assets?.[0]?.uri) return null
  const srcUri = picked.assets[0].uri

  try {
    // 모바일 최적 압축(길면 용량이 커지므로 자동으로 눌러 작게). auto = WhatsApp 방식.
    const outUri: string = await Video.compress(
      srcUri,
      { compressionMethod: 'auto', maxSize: 1280, bitrate: 2_000_000 },
      (p: number) => onProgress?.(p * 0.6),  // 압축은 진행률 앞 60%
    )
    // 압축 후 용량 확인(길이 제한 없이 용량으로만 제한)
    const info = await fetch(outUri)
    const blob = await info.blob()
    if (blob.size > MAX_VIDEO_BYTES) {
      return { error: `영상이 너무 커요(${Math.round(blob.size / 1048576)}MB). 더 짧은 영상을 올려주세요.` }
    }
    const pre = await presign('mp4')
    if ('error' in pre) return pre
    const put = await fetch(pre.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'video/mp4' } })
    if (!put.ok) return { error: '업로드에 실패했어요. 다시 시도해주세요.' }
    onProgress?.(1)
    return { url: pre.publicUrl }
  } catch (e) {
    return { error: '동영상 처리 중 문제가 생겼어요.' }
  }
}
