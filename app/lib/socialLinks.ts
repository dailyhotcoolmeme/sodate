import type { Ionicons } from '@expo/vector-icons'

/**
 * 업체·매장의 외부 링크(홈페이지·SNS) — 아이콘 한 줄로 보여주기 위한 공통 정의(2026-09-02).
 *
 * 예전엔 업체 화면에 `홈페이지` `인스타그램` 을 회색 테두리 **글자 버튼**으로 깔아놨는데,
 * 바로 옆의 `알림 받기`(앱 안 기능)와 생김새가 똑같아 구분이 안 됐다. 게다가 `홈페이지`는
 * `base_url` 이 필수 컬럼이라 **링크가 없는 업체도 항상 떴고**, 눌리면 크롤 대상 주소로
 * 엉뚱하게 나갔다(2026-09-02 오너 지적: "누가 이렇게 촌스럽게 넣으래").
 *
 * 이제 **업체명 바로 밑에 아이콘만** 놓고, 등록된 것만 그린다.
 *
 * ⚠️ 네이버 블로그·카카오채널은 Ionicons 에 로고가 없다. 브랜드 마크를 흉내 내는 대신
 *    성격을 나타내는 아이콘(글·말풍선)을 쓴다 — 자리는 구분되고 오해는 없다.
 */
export type SocialKey =
  | 'homepage' | 'instagram' | 'facebook' | 'tiktok'
  | 'youtube' | 'x' | 'threads' | 'blog' | 'kakao'

type IonName = keyof typeof Ionicons.glyphMap

export const SOCIAL_META: Record<SocialKey, { icon: IonName; label: string }> = {
  homepage:  { icon: 'globe-outline',              label: '홈페이지' },
  instagram: { icon: 'logo-instagram',             label: '인스타그램' },
  facebook:  { icon: 'logo-facebook',              label: '페이스북' },
  tiktok:    { icon: 'logo-tiktok',                label: '틱톡' },
  youtube:   { icon: 'logo-youtube',               label: '유튜브' },
  x:         { icon: 'logo-x',                     label: 'X' },
  threads:   { icon: 'logo-threads',               label: '스레드' },
  blog:      { icon: 'journal-outline',            label: '블로그' },
  kakao:     { icon: 'chatbubble-ellipses-outline', label: '카카오채널' },
}

/** 아이콘 줄에 놓는 순서. 등록 안 된 것은 건너뛴다. */
const ORDER: SocialKey[] = [
  'homepage', 'instagram', 'youtube', 'blog', 'facebook', 'threads', 'tiktok', 'x', 'kakao',
]

export interface SocialLink {
  key: SocialKey
  icon: IonName
  label: string
  url: string
}

/**
 * 등록된 링크만 순서대로.
 *
 * @param socials  companies.socials / places.socials (없으면 빈 객체)
 * @param fallback 옛 단일 컬럼(instagram_url 등)을 살려 쓰고 싶을 때. socials 에 같은
 *                 키가 있으면 그쪽이 이긴다 — admin 에서 고친 값이 항상 우선이어야 한다.
 */
export function buildSocialLinks(
  socials?: Record<string, string> | null,
  fallback?: Partial<Record<SocialKey, string | null | undefined>>,
): SocialLink[] {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(fallback ?? {})) {
    if (v && String(v).trim()) merged[k] = String(v).trim()
  }
  for (const [k, v] of Object.entries(socials ?? {})) {
    if (v && String(v).trim()) merged[k] = String(v).trim()
  }
  return ORDER.filter((k) => merged[k]).map((k) => ({
    key: k, icon: SOCIAL_META[k].icon, label: SOCIAL_META[k].label, url: merged[k],
  }))
}
