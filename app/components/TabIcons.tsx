import React from 'react'
import { Image } from 'react-native'
import Svg, { Path } from 'react-native-svg'

/**
 * 바텀내비 탭 아이콘 — Streamline "Flex color" 세트(2026-08-26 오너 선택).
 *
 * ⚠️ 라이선스: CC BY 4.0. 상업적 이용은 자유지만 **출처표기가 필수**다.
 *    Streamline 공식 안내상 모바일 앱은 "About/Credits 페이지"에 표기하면 되므로,
 *    설정 화면(app/settings.tsx) '앱 정보'에 "Free icons from Streamline" 링크를 둔다.
 *    그 줄을 지우면 라이선스 위반이 되니 함께 지우지 말 것.
 *
 * 원본은 남색 선(#4147d5) + 연파랑 면(#d7e0ff) 2톤인데, CC BY 는 수정을 허용하므로
 * 앱 브랜드색으로 바꿔 쓴다 — 선택 탭은 핑크, 비선택은 회색(호출부에서 색을 넘긴다).
 * 원본 SVG 의 흰색(#fff) 하이라이트 조각도 면색(fill)으로 묶었다 — 다크모드에서
 * 흰 덩어리가 그대로 남아 뜨는 걸 막기 위해서다.
 */
/**
 * 선 굵기(viewBox 14 기준). 원본 Streamline 값은 1 이었는데 32px 로 키워 그리니
 * 두꺼워 보인다는 지적이 있어 얇게 낮췄다(2026-08-27 오너 지시).
 * 실제 화면 두께 ≈ 아이콘크기 / 14 * 이 값 — 32px 아이콘이면 약 1.7px.
 */
const STROKE_W = 0.75

/**
 * 커뮤니티(가운데) 아이콘 전용 선 굵기. 이 아이콘만 52px 로 훨씬 크게 그려서 같은
 * 굵기 값을 써도 화면상 선이 더 두꺼워 보인다 — 그만큼 더 얇게 잡는다(오너 지시).
 */
const STROKE_W_CENTER = 0.5

export interface IconProps {
  size: number
  /** 안쪽 면색(연한 톤) */
  fill: string
  /** 외곽선색(진한 톤) */
  stroke: string
}

/**
 * 소개팅 탭 — 외부에서 받은 선화 아이콘(assets/tab-event.png)을 그대로 쓴다.
 * ⚠️ 느낌 확인용 임시 적용(2026-08-31 오너 요청). 원본은 큰 일러스트라 40px 로 줄이면
 *    선이 1px 이하로 얇아져 흐릿했다 — 알파 채널을 팽창(MaxFilter 7)시켜 선을 굵힌
 *    버전을 쓴다. 그래도 래스터라 얼굴 안쪽 디테일은 뭉갠다. 확정되면 SVG 로 교체할 것.
 * 단색(흰색 + 알파)으로 뽑아뒀기 때문에 tintColor 하나로 선택/비선택 색을 바꾼다.
 */
export function EventPhotoIcon({ size, stroke }: IconProps) {
  return (
    <Image
      source={require('../assets/tab-event.png')}
      style={{ width: size, height: size, tintColor: stroke }}
      resizeMode="contain"
    />
  )
}

/**
 * 소셜링 탭 — 외부 선화 아이콘(assets/tab-socialing.png). 처리 방식은 EventPhotoIcon 과 같다.
 */
export function SocialingPhotoIcon({ size, stroke }: IconProps) {
  return (
    <Image
      source={require('../assets/tab-socialing.png')}
      style={{ width: size, height: size, tintColor: stroke }}
      resizeMode="contain"
    />
  )
}

export function HeartIcon({ size, fill, stroke }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Path d="M7 3.183C3.98-.522.792 2.111.75 4.949C.75 9.173 5.805 12.64 7 12.64s6.25-3.468 6.25-7.692C13.208 2.11 10.02-.522 7 3.183" fill={fill} />
      <Path d="M7 3.183C3.98-.522.792 2.111.75 4.95c0 4.224 5.055 7.69 6.25 7.69s6.25-3.467 6.25-7.692C13.208 2.11 10.02-.522 7 3.183" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function GroupIcon({ size, fill, stroke }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Path d="m2.374 9.907l.024.43a1.9 1.9 0 0 0 1.788 1.789q.697.04 1.383.062M8.601 1.854a48 48 0 0 1 1.464.064c.964.057 1.73.824 1.788 1.788q.029.481.047.957" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3.83 4.585c1.47 0 2.418 1.155 2.418 2.676H1.413c0-1.521.948-2.676 2.417-2.676" fill={fill} />
      <Path d="M3.83 4.585c1.47 0 2.418 1.155 2.418 2.676H1.413c0-1.521.948-2.676 2.417-2.676" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10.47 10.262c1.47 0 2.418 1.154 2.418 2.676H8.052c0-1.522.949-2.676 2.418-2.676" fill={fill} />
      <Path d="M10.47 10.262c1.47 0 2.418 1.154 2.418 2.676H8.052c0-1.522.949-2.676 2.418-2.676" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3.83 4.585c1.055 0 1.648-.593 1.648-1.647S4.885 1.29 3.83 1.29s-1.647.593-1.647 1.648s.593 1.647 1.647 1.647" fill={fill} />
      <Path d="M3.83 4.585c1.055 0 1.648-.593 1.648-1.647S4.885 1.29 3.83 1.29s-1.647.593-1.647 1.648s.593 1.647 1.647 1.647" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10.47 10.262c1.054 0 1.648-.593 1.648-1.647s-.594-1.648-1.648-1.648c-1.055 0-1.648.593-1.648 1.648s.593 1.647 1.648 1.647" fill={fill} />
      <Path d="M10.47 10.262c1.054 0 1.648-.593 1.648-1.647s-.594-1.648-1.648-1.648c-1.055 0-1.648.593-1.648 1.648s.593 1.647 1.648 1.647" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function ChatIcon({ size, fill, stroke }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Path d="M7.25 12.78c3.84 0 6-2.16 6-6s-2.16-6-6-6s-6 2.16-6 6c0 1.173.201 2.189.59 3.034l-.987 2.713a.5.5 0 0 0 .628.646l2.825-.942c.828.362 1.813.55 2.944.55Z" fill={fill} />
      <Path d="M7.25 12.78c3.84 0 6-2.16 6-6s-2.16-6-6-6s-6 2.16-6 6c0 1.173.201 2.189.59 3.034l-.987 2.713a.5.5 0 0 0 .628.646l2.825-.942c.828.362 1.813.55 2.944.55ZM4.385 6.567V7m2.92-.433V7m2.919-.433V7" fill="none" stroke={stroke} strokeWidth={STROKE_W_CENTER} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function CocktailIcon({ size, fill, stroke }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Path d="M12.156 2.61L8.567 7.137a2 2 0 0 1-3.134 0L1.845 2.61A1 1 0 0 1 2.628.989h8.744a1 1 0 0 1 .784 1.62" fill={fill} />
      <Path d="M12.156 2.61L8.567 7.137a2 2 0 0 1-3.134 0L1.845 2.61A1 1 0 0 1 2.628.989h8.744a1 1 0 0 1 .784 1.62M7 7.898v5.113m2.656 0H4.344" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function UserCircleIcon({ size, fill, stroke }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Path d="M7 13.5c4.16 0 6.5-2.34 6.5-6.5S11.16.5 7 .5S.5 2.84.5 7s2.34 6.5 6.5 6.5" fill={fill} />
      <Path d="M10.704 12.647c-.992.561-2.235.853-3.704.853s-2.712-.292-3.704-.853v-.612a3.833 3.833 0 0 1 7.408 0z" fill={fill} />
      <Path d="M10.704 12.035a3.832 3.832 0 0 0-7.408 0" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7 13.5c4.16 0 6.5-2.34 6.5-6.5S11.16.5 7 .5S.5 2.84.5 7s2.34 6.5 6.5 6.5" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7 7.58c1.4 0 2.187-.788 2.187-2.188s-.788-2.187-2.188-2.187s-2.187.787-2.187 2.187s.787 2.188 2.187 2.188" fill={fill} />
      <Path d="M7 7.58c1.4 0 2.187-.788 2.187-2.188s-.788-2.187-2.188-2.187s-2.187.787-2.187 2.187s.787 2.188 2.187 2.188" fill="none" stroke={stroke} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}