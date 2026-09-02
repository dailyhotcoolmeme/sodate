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

export const getAvatar = (id: string | null | undefined): Avatar | undefined =>
  id ? AVATARS.find((a) => a.id === id) : undefined

/** 아바타 이미지 소스. 모르는 id 면 undefined. */
export const avatarSource = (id: string | null | undefined): ImageSourcePropType | undefined =>
  getAvatar(id)?.source

/** 랜덤 아바타 id — 첫 실행 시 자동 배정용(빈 이미지 없이 바로 캐릭터). */
export const randomAvatarId = (): string =>
  AVATARS[Math.floor(Math.random() * AVATARS.length)].id

/** 지금 기기에 선택돼 있는 캐릭터 id — 글·댓글·후기를 쓸 때 같이 저장해 **남에게도** 보이게
 *  한다(2026-09-03 오너 지시). 아직 안 골랐으면 null 이고, 그때는 서버가 소유권 해시로
 *  하나 정해준다(옛 글 일괄 배정과 같은 규칙이라 같은 사람은 늘 같은 캐릭터가 된다). */
export const currentAvatarId = (): string | null => useAvatarStore.getState().avatarId
