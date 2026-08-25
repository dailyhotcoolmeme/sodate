// react-native-reanimated(react-native-keyboard-controller KeyboardStickyView 가 내부적으로
// 씀 — 안드 "키보드 위 고정 툴바 안 뜸" 버그 수정용, 2026-08-26)에 이 플러그인이 꼭 있어야
// 웹뷰 없는 위젯의 worklet 코드가 정상 변환된다. babel.config.js 자체가 이 프로젝트에
// 지금까지 없었다(reanimated 를 처음 쓰는 것) — Expo 기본 프리셋만 그대로 지정한다.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  }
}
