import React, { useEffect, useRef, useState } from 'react'
import { TurboModuleRegistry, UIManager, View, Text, type StyleProp, type ViewStyle } from 'react-native'

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

// 이 줌 이하 = 전부 숫자 클러스터, 초과 = 전부 개별 사진 마커. 한 화면에 둘을 절대 안 섞는다
// (2026-08-25, 두 번째 정정 — screenDistance 만으로 풀려다가 도시 전체 줌(12)에서 "14"
// 클러스터 바로 옆에 사진 마커 두 개가 따로 떠서 뒤죽박죽으로 보였다. 오너 지적: "숫자 2는
// 뭐고, 14 옆에는 왜 업체 이미지가 나오냐"). 기본 진입 줌이 12(도시 전체), 매장 선택 시
// 16(블록 단위)이라 그 사이인 15를 경계로 잡는다 — 15 이하는 항상 전부 클러스터.
const CLUSTER_MAX_ZOOM = 15

export interface MapPin {
  id: string
  lat: number
  lng: number
  name?: string
  markerUrl?: string     // 원형 대표사진 마커 이미지(R2). 없으면 기본 핀.
  active?: boolean       // 선택된 매장(히어로의 진짜 주인공) = 크게 강조
  /** 주변 핀 중 지금 미리보기 카드로 열려 있는 것(2026-08-24 오너 지적: "선택한 점이
   *  표시는 안되냐?") — active 는 아니지만 다른 주변 점보다는 크게 그려 구분한다. */
  selected?: boolean
  onPress?: () => void
}

interface Props {
  focus: { lat: number; lng: number }
  pins: MapPin[]
  zoom?: number
  style?: StyleProp<ViewStyle>
  showLocationButton?: boolean
  cluster?: boolean
  /** screen — 탭한 마커의 화면 좌표(가능하면). 미리보기 카드를 그 점 바로 아래에 띄우려고
   *  (2026-08-24 오너 지적: "업체박스 왜 왼쪽 밑에 고정이냐, 누른 점 바로 밑에 떠야지"). */
  onTapPin?: (id: string, screen?: { x: number; y: number }) => void
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
  /** true면 마커 탭마다 coordinateToScreen 네이티브 호출로 화면좌표를 구해 onTapPin 에
   *  같이 넘긴다(히어로 미리보기 카드 위치용). 이 호출은 비동기라 콜백이 한 프레임 늦게
   *  온다 — 지도탭(honsul/index.tsx)처럼 좌표가 필요 없는 곳까지 기본으로 켜뒀더니
   *  "여기는 왜 이렇게 느리냐"는 지적을 받았다(2026-08-24). 필요한 곳에서만 켠다. */
  resolveTapScreen?: boolean
}

export default function PlaceMap({ focus, pins, zoom = 15, style, showLocationButton = false, cluster = false, onTapPin, onTapBackground, hideBasePoi = false, compactPins = false, resolveTapScreen = false }: Props) {
  const ref = useRef<any>(null)
  const [camZoom, setCamZoom] = useState(zoom)
  useEffect(() => {
    ref.current?.animateCameraTo?.({ latitude: focus.lat, longitude: focus.lng, zoom })
    setCamZoom(zoom)
  }, [focus.lat, focus.lng, zoom])

  if (!NaverMapView) return null

  const activePin = pins.find((p) => p.active)
  const expanded = !cluster || camZoom > CLUSTER_MAX_ZOOM

  // screenDistance 는 "이 줌 구간 안에서 클러스터가 얼마나 잘게 쪼개지는지"만 결정한다
  // (예: 6/10/7/2/14 처럼 지역별로 나뉘는 것) — 개별 사진으로 풀리는 시점은 위 expanded
  // (줌 경계)가 전담한다. 100px 정도면 도시 스케일에서 역세권 단위로 자연스럽게 갈린다.
  const clusterProps = cluster && !expanded
    ? [{
        width: 52,
        height: 52,
        screenDistance: 100,
        minZoom: 0,
        maxZoom: CLUSTER_MAX_ZOOM,
        animate: true,
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
    <View style={style}>
    <NaverMapView
      ref={ref}
      style={{ flex: 1 }}
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
      {/* expanded(줌 15 초과)면 전부 개별 사진 마커, 아니면 선택된 매장만(나머지는 클러스터가 그림) —
          한 화면에 숫자뭉치와 사진마커를 절대 안 섞는다(2026-08-25). */}
      {(expanded ? pins : activePin ? [activePin] : []).map((p) => {
        const size = compactPins ? (p.active ? 24 : p.selected ? 20 : 12) : p.active ? 62 : 44
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
            onTap={async () => {
              if (!onTapPin) { p.onPress?.(); return }
              if (!resolveTapScreen) { onTapPin(p.id); return }
              const pos = await ref.current?.coordinateToScreen?.({ latitude: p.lat, longitude: p.lng })
              onTapPin(p.id, pos?.isValid ? { x: pos.screenX, y: pos.screenY } : undefined)
            }}
            width={size}
            height={size}
            zIndex={p.active ? 100 : p.selected ? 50 : 0}
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
    {/* 임시 디버그 — 실제 기기에서 CLUSTER_MAX_ZOOM 값을 눈으로 보면서 맞는 숫자를 잡기 위함
        (2026-08-25). 여러 번 숫자를 추측했다가 계속 틀려서, 이번엔 오너가 화면으로 직접
        실제 zoom 값을 보고 알려주면 그 값으로 정확히 맞춘다. 값 확정되면 이 블록은 지운다. */}
    {cluster && (
      <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
          zoom {camZoom.toFixed(2)} (경계 {CLUSTER_MAX_ZOOM})
        </Text>
      </View>
    )}
    </View>
  )
}
