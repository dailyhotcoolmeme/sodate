import type { ImageSourcePropType } from 'react-native'
import { useAvatarStore } from '@/stores/avatarStore'

/**
 * 프로필 프리셋 아바타 24종(2026-09-03 오너가 'adventurer-neutral' 선택).
 *
 * 소스: DiceBear adventurer-neutral, 시드 moit1~24. **CC BY 4.0** 이라 출처 표기 의무가
 * 있다 — MY 화면 맨 아래 '캐릭터' 줄에 제작자(Lisa Wischofsky)를 적어 뒀다. 지우면 안 된다.
 *
 * 예전엔 움직이는 thumbs(CC0)를 썼는데, 닉네임 앞 15px 로는 눈 깜빡임이 안 보여서
 * 통째로 바꿨다. 이건 정지 그림이다.
 *
 * ⚠️ id 는 'thumbs_01~24' 그대로 둔다 — 그림만 바뀌었지 **자리 번호**는 같다. 이미 글·댓글·
 *    후기 3천여 건에 이 id 가 저장돼 있어서, 이름을 바꾸면 전부 갈아엎어야 하고 아직 업데이트
 *    안 한 구버전 앱은 모르는 id 를 받아 캐릭터가 사라진다.
 *
 * 앱 내장·오프라인. id 만 기기에 저장(avatarStore). 없으면 기본 사람 아이콘.
 */
export type Avatar = { id: string; source: ImageSourcePropType }

export const AVATARS: Avatar[] = [
  { id: 'thumbs_01', source: require('../assets/avatars/thumbs_01.webp') },
  { id: 'thumbs_02', source: require('../assets/avatars/thumbs_02.webp') },
  { id: 'thumbs_03', source: require('../assets/avatars/thumbs_03.webp') },
  { id: 'thumbs_04', source: require('../assets/avatars/thumbs_04.webp') },
  { id: 'thumbs_05', source: require('../assets/avatars/thumbs_05.webp') },
  { id: 'thumbs_06', source: require('../assets/avatars/thumbs_06.webp') },
  { id: 'thumbs_07', source: require('../assets/avatars/thumbs_07.webp') },
  { id: 'thumbs_08', source: require('../assets/avatars/thumbs_08.webp') },
  { id: 'thumbs_09', source: require('../assets/avatars/thumbs_09.webp') },
  { id: 'thumbs_10', source: require('../assets/avatars/thumbs_10.webp') },
  { id: 'thumbs_11', source: require('../assets/avatars/thumbs_11.webp') },
  { id: 'thumbs_12', source: require('../assets/avatars/thumbs_12.webp') },
  { id: 'thumbs_13', source: require('../assets/avatars/thumbs_13.webp') },
  { id: 'thumbs_14', source: require('../assets/avatars/thumbs_14.webp') },
  { id: 'thumbs_15', source: require('../assets/avatars/thumbs_15.webp') },
  { id: 'thumbs_16', source: require('../assets/avatars/thumbs_16.webp') },
  { id: 'thumbs_17', source: require('../assets/avatars/thumbs_17.webp') },
  { id: 'thumbs_18', source: require('../assets/avatars/thumbs_18.webp') },
  { id: 'thumbs_19', source: require('../assets/avatars/thumbs_19.webp') },
  { id: 'thumbs_20', source: require('../assets/avatars/thumbs_20.webp') },
  { id: 'thumbs_21', source: require('../assets/avatars/thumbs_21.webp') },
  { id: 'thumbs_22', source: require('../assets/avatars/thumbs_22.webp') },
  { id: 'thumbs_23', source: require('../assets/avatars/thumbs_23.webp') },
  { id: 'thumbs_24', source: require('../assets/avatars/thumbs_24.webp') },
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
