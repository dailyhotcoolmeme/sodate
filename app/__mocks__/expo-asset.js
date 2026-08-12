// expo-asset 은 이 프로젝트에 직접 설치돼 있지 않은데(@expo/vector-icons → expo-font 가
// 내부적으로 요구), 그래서 아이콘을 쓰는 컴포넌트 테스트가 "Cannot find module 'expo-asset'"
// 으로 통째로 죽었다. 테스트에서 실제 에셋 로딩은 필요 없으므로 최소한만 흉내 낸다.
class Asset {
  constructor(props = {}) {
    Object.assign(this, { name: '', type: '', uri: '', localUri: null, downloaded: true }, props)
  }
  static fromModule(mod) { return new Asset({ uri: String(mod), localUri: String(mod) }) }
  static fromURI(uri) { return new Asset({ uri, localUri: uri }) }
  static loadAsync(mods) {
    const list = Array.isArray(mods) ? mods : [mods]
    return Promise.resolve(list.map((m) => Asset.fromModule(m)))
  }
  downloadAsync() { return Promise.resolve(this) }
}

module.exports = { Asset, useAssets: () => [undefined, undefined] }
