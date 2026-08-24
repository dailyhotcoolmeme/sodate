import { Alert } from 'react-native'

/**
 * 내 위치 얻기(내 주변 정렬용). expo-location 은 네이티브 모듈이라 재빌드 전 바이너리엔
 * 없을 수 있다 — 실패하면 조용히 null 반환(호출부가 안내). 권한 거부도 null.
 */
export async function getMyLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    const Location = await import('expo-location')
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('위치 권한 필요', '내 주변 혼술바를 보려면 위치 권한을 허용해주세요.')
      return null
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: 3 })
    return { lat: pos.coords.latitude, lng: pos.coords.longitude }
  } catch {
    return null
  }
}

/** 두 좌표 간 거리(km, 하버사인). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
