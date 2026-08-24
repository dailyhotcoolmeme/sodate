import React, { useEffect, useRef, useState } from 'react'
import { TurboModuleRegistry, UIManager, type StyleProp, type ViewStyle } from 'react-native'

/**
 * 혼술바 지도(네이버 지도). 히어로(단일 핀)·지도탭(다수 핀·클러스터) 공용.
 *
 * ⚠️ 네이티브 모듈이라 재빌드 전 바이너리엔 없다. @mj-studio 를 "정적 import" 하면
 * 모듈 로드 시점에 TurboModuleRegistry.getEnforcing 가 실행돼 앱이 부팅부터 크래시한다.
 * → 네이티브가 실제로 등록돼 있을 때만 require 한다. 없으면 호출부가 안내로 폴백.
 *
 * 지도탭(cluster=true): 매장 대표사진을 원형 마커로, 근접 마커는 클러스터(개수)로 묶는다.
 * 마커 탭 → onTapPin(id) 로 하단 정보카드를 띄운다(honsul/index.tsx).
 */
// ⚠️ 감지는 TurboModule 유무로 한다. 이 라이브러리는 웹뷰와 달리 JS 에 뷰 설정을 내장하지
// 않아 UIManager.getViewManagerConfig('RNCNaverMapView') 가 네이티브가 있어도 null 이었다
// (2026-08-24: 재빌드했는데도 "지도는 준비 중"이 뜨던 원인). getEnforcing 이 아니라 get 이라
// 없으면 null 을 돌려줄 뿐 크래시하지 않는다.
export const NAVER_MAP_AVAILABLE =
  !!TurboModuleRegistry.get?.('RNCNaverMapUtil') || !!UIManager.getViewManagerConfig?.('RNCNaverMapView')

let NaverMapView: any = null
let NaverMapMarkerOverlay: any = null
if (NAVER_MAP_AVAILABLE) {
  const m = require('@mj-studio/react-native-naver-map')
  NaverMapView = m.NaverMapView
  NaverMapMarkerOverlay = m.NaverMapMarkerOverlay
}

/** 이 줌 이하 = 숫자 클러스터만, 초과 = 원형 대표사진 마커만(섞이지 않게). */
const CLUSTER_MAX_ZOOM = 14

export interface MapPin {
  id: string
  lat: number
  lng: number
  name?: string
  markerUrl?: string     // 원형 대표사진 마커 이미지(R2). 없으면 기본 핀.
  active?: boolean       // 선택된 매장 = 크게 강조
  onPress?: () => void
}

interface Props {
  focus: { lat: number; lng: number }
  pins: MapPin[]
  zoom?: number
  style?: StyleProp<ViewStyle>
  showLocationButton?: boolean
  cluster?: boolean
  onTapPin?: (id: string) => void
  /** 마커가 아닌 지도 빈 공간을 탭했을 때 — 미리보기 카드를 열어놨으면 닫아야 한다
   *  (2026-08-24 오너 지적: "박스 바깥쪽 누르면 박스가 닫혀야 한다"). */
  onTapBackground?: () => void
  /** 상세페이지 히어로용 — 네이버 기본 지도가 자체로 그리는 주변 업체 숫자 심벌(노란 원)들을
   *  꺼서 우리 핀만 깔끔하게 보이게 한다(2026-08-24 오너 지적: "히어로 지도가 저딴식이냐").
   *  symbolScale=0 이면 기본 심벌이 전부 숨겨진다 — 지도탭(전체 지도)에선 그대로 둔다. */
  hideBasePoi?: boolean
  /** 상세 히어로 전용 축소 마커(2026-08-24, 오너 승인 A안) — 기본 62px 물방울 핀이 200px
   *  히어로 지도엔 과하게 커서("대가리 큰 병신처럼") 선택 매장은 26px 소형 핀+이름표,
   *  주변 매장은 12px 파랑 점으로 훨씬 작게 그린다. 지도탭(cluster 모드)은 그대로 둔다. */
  compactPins?: boolean
}

export default function PlaceMap({ focus, pins, zoom = 15, style, showLocationButton = false, cluster = false, onTapPin, onTapBackground, hideBasePoi = false, compactPins = false }: Props) {
  const ref = useRef<any>(null)
  // 현재 카메라 줌 — 이 값으로 "숫자만" / "사진만"을 딱 갈라 한 화면에 섞이지 않게 한다.
  const [camZoom, setCamZoom] = useState(zoom)
  useEffect(() => {
    ref.current?.animateCameraTo?.({ latitude: focus.lat, longitude: focus.lng, zoom })
    setCamZoom(zoom)
  }, [focus.lat, focus.lng, zoom])

  if (!NaverMapView) return null

  const activePin = pins.find((p) => p.active)
  // 확대 상태(= 사진 마커 구간)인지. 지도탭에서만 의미 있다.
  const expanded = !cluster || camZoom > CLUSTER_MAX_ZOOM

  // 지도탭: 클러스터링. 선택된 매장은 클러스터에서 빼고 위에 크게 따로 그린다.
  // 한 화면엔 항상 한 종류만 보이게 한다 — 네이버지도·카카오맵도 같은 배율에서 마커 모양을
  // 섞지 않는다(2026-08-24 조사). screenDistance 를 크게 잡아 CLUSTER_MAX_ZOOM 이하에선
  // 사실상 전부 뭉쳐 숫자로, 그보다 확대하면 전부 원형 대표사진으로 펼쳐진다.
  const clusterProps = cluster && !expanded
    ? [{
        width: 52,
        height: 52,
        screenDistance: 400,
        minZoom: 0,
        maxZoom: 21,          // 이 구간에선 무조건 뭉친다(사진 마커가 섞이지 않게)
        animate: true,
        // 축소 구간의 개별(혼자 떨어진) 매장은 라이브러리가 leaf 로 직접 그린다 — 여기에
        // 대표사진을 주면 숫자 뭉치와 사진이 한 화면에 섞인다. 그래서 이 구간에선 전부
        // 같은 핑크 점으로 통일한다(확대하면 사진 마커로 바뀜).
        markers: pins
          .filter((p) => !p.active)
          .map((p) => ({
            identifier: p.id,
            latitude: p.lat,
            longitude: p.lng,
            width: 22,
            height: 22,
            image: require('../assets/map-dot.png'),
          })),
      }]
    : undefined

  return (
    <NaverMapView
      ref={ref}
      style={style}
      initialCamera={{ latitude: focus.lat, longitude: focus.lng, zoom }}
      isShowLocationButton={showLocationButton}
      isShowZoomControls={cluster}
      isShowScaleBar={false}
      symbolScale={hideBasePoi ? 0 : 1}
      clusters={clusterProps}
      onTapClusterLeaf={cluster ? (e: { markerIdentifier: string }) => onTapPin?.(e.markerIdentifier) : undefined}
      onCameraChanged={cluster ? (e: { zoom: number }) => setCamZoom(e.zoom) : undefined}
      onTapMap={onTapBackground}
    >
      {/* 확대 구간이면 개별 사진 마커 전부, 축소 구간이면 선택된 것만(나머지는 클러스터가 그림) */}
      {(expanded ? pins : activePin ? [activePin] : []).map((p) => {
        const size = compactPins ? (p.active ? 24 : 12) : p.active ? 62 : 44
        // ⚠️(2026-08-24) 기본 'pink'/'blue' 심벌은 둘 다 물방울(세로로 긴) 모양이라 정사각형
        // 크기로 찍으면 눌려서 "짜부된" 모양이 된다(오너 지적 — 처음엔 선택 마커만 고쳤다가
        // "주변 점은 짜부가 안되겠냐"고 또 지적받음). compactPins 에선 선택·주변 둘 다 원형 점
        // (정원이라 어떤 정사각형 크기로 찍어도 안 눌림) — map-dot.png(핑크)/map-dot-blue.png.
        const image = p.markerUrl
          ? { httpUri: p.markerUrl }
          : compactPins
            ? (p.active ? require('../assets/map-dot.png') : require('../assets/map-dot-blue.png'))
            : { symbol: p.active ? 'pink' : 'blue' }
        return (
          <NaverMapMarkerOverlay
            key={p.id}
            latitude={p.lat}
            longitude={p.lng}
            onTap={() => (onTapPin ? onTapPin(p.id) : p.onPress?.())}
            width={size}
            height={size}
            zIndex={p.active ? 100 : 0}
            caption={
              !cluster && p.name && (!compactPins || p.active)
                ? { text: p.name, textSize: 12, haloColor: '#fff' }
                : undefined
            }
            image={image}
          />
        )
      })}
    </NaverMapView>
  )
}
