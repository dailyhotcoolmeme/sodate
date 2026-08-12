// AsyncStorage 는 네이티브 모듈이라 jest 환경에서 그대로 부르면 "NativeModule is null"로
// 죽는다. 라이브러리가 제공하는 공식 목을 쓴다 — 이게 없어서 스토어를 import 하는
// 컴포넌트 테스트(EventCard 등)가 전부 실행조차 안 됐다.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)
