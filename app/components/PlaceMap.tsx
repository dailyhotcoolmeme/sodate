import React, { useEffect, useRef } from 'react'
import { UIManager, type StyleProp, type ViewStyle } from 'react-native'

/**
 * 혼술바 지도(네이버 지도). 히어로(단일 핀)·지도탭(다수 핀) 공용.
 *
 * ⚠️ 네이티브 모듈이라 재빌드 전 바이너리엔 없다. @mj-studio 를 "정적 import" 하면
 * 모듈 로드 시점에 TurboModuleRegistry.getEnforcing('RNCNaverMapUtil') 가 실행돼
 * 앱이 부팅부터 크래시한다(feature-detect로도 못 막음 — import 시점이라).
 * → 네이티브가 실제로 등록돼 있을 때만 require 한다. 없으면 호출부가 OSM/플레이스홀더로 폴백.
 */
export const NAVER_MAP_AVAILABLE = !!UIManager.getViewManagerConfig?.('RNCNaverMapView')

let NaverMapView: any = null
let NaverMapMarkerOverlay: any = null
if (NAVER_MAP_AVAILABLE) {
  const m = require('@mj-studio/react-native-naver-map')
  NaverMapView = m.NaverMapView
  NaverMapMarkerOverlay = m.NaverMapMarkerOverlay
}

export interface MapPin {
  id: string
  lat: number
  lng: number
  name?: string
  active?: boolean       // 현재 보고 있는 업체 = 분홍, 나머지 = 파랑
  onPress?: () => void
}

interface Props {
  focus: { lat: number; lng: number }
  pins: MapPin[]
  zoom?: number
  style?: StyleProp<ViewStyle>
  showLocationButton?: boolean
}

export default function PlaceMap({ focus, pins, zoom = 15, style, showLocationButton = false }: Props) {
  const ref = useRef<any>(null)
  // focus 가 바뀌면(지도탭에서 특정 업체 선택 등) 그 위치로 카메라 이동
  useEffect(() => {
    ref.current?.animateCameraTo?.({ latitude: focus.lat, longitude: focus.lng, zoom })
  }, [focus.lat, focus.lng, zoom])

  if (!NaverMapView) return null   // 이중 방어(호출부가 NAVER_MAP_AVAILABLE 로 이미 걸러줌)

  return (
    <NaverMapView
      ref={ref}
      style={style}
      initialCamera={{ latitude: focus.lat, longitude: focus.lng, zoom }}
      isShowLocationButton={showLocationButton}
    >
      {pins.map((p) => (
        <NaverMapMarkerOverlay
          key={p.id}
          latitude={p.lat}
          longitude={p.lng}
          onTap={p.onPress}
          caption={p.name ? { text: p.name, textSize: 12 } : undefined}
          tintColor={p.active ? '#FF6B9D' : '#5b9dff'}
        />
      ))}
    </NaverMapView>
  )
}
