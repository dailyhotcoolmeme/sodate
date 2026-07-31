import type { ViewStyle } from 'react-native'

/**
 * 넓은 화면(iPad)에서 내용이 가로로 늘어지지 않게 폭을 제한한다.
 *
 * 애플이 두 번째 반려(2026-07-31)에서 iPad를 따로 짚었다. iPhone 전용으로 두면
 * 좌우가 검게 남는 호환 모드로 돌아 '제대로 동작하지 않는다'고 본다.
 * 그래서 iPad 지원을 켰는데(app.json supportsTablet), 그대로 두면 목록 한 줄이
 * 화면 끝까지 늘어져 읽기 어렵다. 본문 폭을 묶고 가운데로 모은다.
 *
 * ⚠️ supportsTablet 변경은 네이티브 설정이라 OTA로는 반영되지 않는다. 새 빌드 필요.
 */
export const CONTENT_MAX_WIDTH = 720

/** 스크롤 목록의 contentContainerStyle 에 얹는다. */
export const wideContent: ViewStyle = {
  width: '100%',
  maxWidth: CONTENT_MAX_WIDTH,
  alignSelf: 'center',
}
