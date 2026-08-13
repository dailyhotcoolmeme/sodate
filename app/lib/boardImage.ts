import { supabase } from '@/lib/supabase'
import { getOrCreateToken } from '@/lib/reviewIdentity'

/**
 * 게시판 사진 첨부.
 *
 * 앱이 Storage 에 직접 올리면 익명 사용자에게 쓰기 권한을 열어야 한다. 그래서
 * board Edge Function 으로 보내고, 거기서 차단된 기기를 먼저 걸러낸 뒤 저장한다.
 *
 * 올리기 전에 긴 변 1280 으로 줄이고 jpeg 로 다시 굽는다. 요즘 폰 사진은 한 장에
 * 5MB 를 넘기기 일쑤라 그대로 보내면 업로드가 오래 걸리고 서버 한도에 걸린다.
 * GIF만 예외 — 재인코딩하면 애니메이션이 사라져서 원본을 그대로 올린다(2026-08-13).
 *
 * ⚠️ 사진 선택은 네이티브 모듈이라 새 빌드가 있어야 동작한다. 모듈을 파일 맨 위에서
 *    불러오면 예전 빌드에서는 화면 자체가 열리지 않으므로, 누를 때 불러온다.
 *    그래야 OTA 로 먼저 내보내도 나머지 기능은 멀쩡하고, 사진만 안내 문구가 뜬다.
 */

function loadNative() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const picker = require('expo-image-picker')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manipulator = require('expo-image-manipulator')
    if (!picker?.launchImageLibraryAsync || !manipulator?.manipulateAsync) return null
    return { picker, manipulator }
  } catch {
    return null
  }
}

export const MAX_IMAGES = 5

/** 사진첩에서 고르고 → 줄이고 → 올린다. 취소하면 null. */
export async function pickAndUpload(): Promise<{ url: string } | { error: string } | null> {
  const native = loadNative()
  if (!native) {
    return { error: '사진 첨부는 다음 앱 업데이트부터 사용할 수 있어요.' }
  }
  const { picker: ImagePicker, manipulator: ImageManipulator } = native

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) {
    return { error: '사진 접근을 허용해야 첨부할 수 있어요. 설정에서 권한을 켜주세요.' }
  }

  // base64: true — GIF는 원본 그대로 올려야 해서(아래) 리사이즈 전에 원본 바이트가 필요하다.
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: false,
    base64: true,
  })
  if (picked.canceled || !picked.assets?.length) return null

  try {
    const asset = picked.assets[0]
    // ⚠️(2026-08-13) GIF는 ImageManipulator를 거치면(정지사진용 리사이즈+JPEG 재인코딩)
    // 애니메이션이 통째로 사라져 정지 프레임 한 장만 남는다 — 이 모듈은 애니메이션 GIF를
    // 못 다룬다. 그래서 GIF만 리사이즈·재인코딩을 건너뛰고 원본 바이트를 그대로 올린다
    // (대신 압축이 안 되니 서버 5MB 제한에 원본 용량 그대로 걸린다).
    const isGif = asset.mimeType === 'image/gif' || /\.gif$/i.test(asset.uri)
    let dataUrl: string
    if (isGif) {
      if (!asset.base64) return { error: 'GIF를 처리하지 못했어요.' }
      dataUrl = `data:image/gif;base64,${asset.base64}`
    } else {
      const resized = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      )
      if (!resized.base64) return { error: '사진을 처리하지 못했어요.' }
      dataUrl = `data:image/jpeg;base64,${resized.base64}`
    }

    const ownerToken = await getOrCreateToken()
    const { data, error } = await supabase.functions.invoke('board', {
      body: {
        action: 'uploadImage',
        dataUrl,
        ownerToken,
      },
    })
    if (error || !data?.url) {
      // 서버가 내려준 문구를 그대로 보여준다(용량 초과·형식 오류 등)
      const ctx = (error as any)?.context
      try {
        const body = ctx && typeof ctx.json === 'function' ? await ctx.json() : null
        if (body?.error) return { error: body.error }
      } catch {
        // 무시하고 아래 기본 문구
      }
      return { error: '사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.' }
    }
    return { url: data.url }
  } catch {
    return { error: '사진을 올리지 못했어요.' }
  }
}
