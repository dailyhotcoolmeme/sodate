import type { ImageSourcePropType } from 'react-native'
import { useAvatarStore } from '@/stores/avatarStore'

/**
 * 프로필 프리셋 아바타 — 움직이는 thumbs 24종(애니메이션 WebP, 무한루프).
 * 소스: DiceBear thumbs animationVariant=fastest (CC0 1.0). 앱 내장·오프라인, expo-image로 재생.
 * id 만 기기에 저장(avatarStore). 없으면 기본 사람 아이콘.
 */
export type Avatar = { id: string; source: ImageSourcePropType }

export const AVATARS: Avatar[] = [
  { id: 'thumbs_01', source: require('../assets/avatars_anim/thumbs_01.webp') },
  { id: 'thumbs_02', source: require('../assets/avatars_anim/thumbs_02.webp') },
  { id: 'thumbs_03', source: require('../assets/avatars_anim/thumbs_03.webp') },
  { id: 'thumbs_04', source: require('../assets/avatars_anim/thumbs_04.webp') },
  { id: 'thumbs_05', source: require('../assets/avatars_anim/thumbs_05.webp') },
  { id: 'thumbs_06', source: require('../assets/avatars_anim/thumbs_06.webp') },
  { id: 'thumbs_07', source: require('../assets/avatars_anim/thumbs_07.webp') },
  { id: 'thumbs_08', source: require('../assets/avatars_anim/thumbs_08.webp') },
  { id: 'thumbs_09', source: require('../assets/avatars_anim/thumbs_09.webp') },
  { id: 'thumbs_10', source: require('../assets/avatars_anim/thumbs_10.webp') },
  { id: 'thumbs_11', source: require('../assets/avatars_anim/thumbs_11.webp') },
  { id: 'thumbs_12', source: require('../assets/avatars_anim/thumbs_12.webp') },
  { id: 'thumbs_13', source: require('../assets/avatars_anim/thumbs_13.webp') },
  { id: 'thumbs_14', source: require('../assets/avatars_anim/thumbs_14.webp') },
  { id: 'thumbs_15', source: require('../assets/avatars_anim/thumbs_15.webp') },
  { id: 'thumbs_16', source: require('../assets/avatars_anim/thumbs_16.webp') },
  { id: 'thumbs_17', source: require('../assets/avatars_anim/thumbs_17.webp') },
  { id: 'thumbs_18', source: require('../assets/avatars_anim/thumbs_18.webp') },
  { id: 'thumbs_19', source: require('../assets/avatars_anim/thumbs_19.webp') },
  { id: 'thumbs_20', source: require('../assets/avatars_anim/thumbs_20.webp') },
  { id: 'thumbs_21', source: require('../assets/avatars_anim/thumbs_21.webp') },
  { id: 'thumbs_22', source: require('../assets/avatars_anim/thumbs_22.webp') },
  { id: 'thumbs_23', source: require('../assets/avatars_anim/thumbs_23.webp') },
  { id: 'thumbs_24', source: require('../assets/avatars_anim/thumbs_24.webp') },
]

/**
 * 목록용 정지컷(96px, 24개 합쳐 57KB). 움직이는 원본은 1.6MB 라 게시판 목록처럼 한 화면에
 * 20~30개가 한꺼번에 뜨는 곳에서 그대로 쓰면 디코딩·애니메이션 비용이 그만큼 늘어난다
 * (2026-09-02 속도 작업 참고). **한 개만 크게 보이는 곳**(MY 프로필, 글 상세 작성자)은
 * 움직이는 걸 쓰고, 여러 개가 작게 늘어서는 곳은 이걸 쓴다.
 */
const STILL: Record<string, ImageSourcePropType> = {
  thumbs_01: require('../assets/avatars_still/thumbs_01.webp'),
  thumbs_02: require('../assets/avatars_still/thumbs_02.webp'),
  thumbs_03: require('../assets/avatars_still/thumbs_03.webp'),
  thumbs_04: require('../assets/avatars_still/thumbs_04.webp'),
  thumbs_05: require('../assets/avatars_still/thumbs_05.webp'),
  thumbs_06: require('../assets/avatars_still/thumbs_06.webp'),
  thumbs_07: require('../assets/avatars_still/thumbs_07.webp'),
  thumbs_08: require('../assets/avatars_still/thumbs_08.webp'),
  thumbs_09: require('../assets/avatars_still/thumbs_09.webp'),
  thumbs_10: require('../assets/avatars_still/thumbs_10.webp'),
  thumbs_11: require('../assets/avatars_still/thumbs_11.webp'),
  thumbs_12: require('../assets/avatars_still/thumbs_12.webp'),
  thumbs_13: require('../assets/avatars_still/thumbs_13.webp'),
  thumbs_14: require('../assets/avatars_still/thumbs_14.webp'),
  thumbs_15: require('../assets/avatars_still/thumbs_15.webp'),
  thumbs_16: require('../assets/avatars_still/thumbs_16.webp'),
  thumbs_17: require('../assets/avatars_still/thumbs_17.webp'),
  thumbs_18: require('../assets/avatars_still/thumbs_18.webp'),
  thumbs_19: require('../assets/avatars_still/thumbs_19.webp'),
  thumbs_20: require('../assets/avatars_still/thumbs_20.webp'),
  thumbs_21: require('../assets/avatars_still/thumbs_21.webp'),
  thumbs_22: require('../assets/avatars_still/thumbs_22.webp'),
  thumbs_23: require('../assets/avatars_still/thumbs_23.webp'),
  thumbs_24: require('../assets/avatars_still/thumbs_24.webp'),
}

export const getAvatar = (id: string | null | undefined): Avatar | undefined =>
  id ? AVATARS.find((a) => a.id === id) : undefined

/** 아바타 이미지 소스. still=true 면 정지컷(목록용). 모르는 id 면 undefined. */
export const avatarSource = (
  id: string | null | undefined,
  still = false,
): ImageSourcePropType | undefined =>
  id ? (still ? STILL[id] : getAvatar(id)?.source) : undefined

/** 랜덤 아바타 id — 첫 실행 시 자동 배정용(빈 이미지 없이 바로 캐릭터). */
export const randomAvatarId = (): string =>
  AVATARS[Math.floor(Math.random() * AVATARS.length)].id

/** 지금 기기에 선택돼 있는 캐릭터 id — 글·댓글·후기를 쓸 때 같이 저장해 **남에게도** 보이게
 *  한다(2026-09-03 오너 지시). 아직 안 골랐으면 null 이고, 그때는 서버가 소유권 해시로
 *  하나 정해준다(옛 글 일괄 배정과 같은 규칙이라 같은 사람은 늘 같은 캐릭터가 된다). */
export const currentAvatarId = (): string | null => useAvatarStore.getState().avatarId
