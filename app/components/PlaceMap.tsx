import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TurboModuleRegistry, UIManager, View, Text, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'

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

// ⚠️(2026-08-25, 세 번째 재작업) 네이버 지도 라이브러리 자체 클러스터링(clusters prop)은
// screenDistance(고정 px)+minZoom/maxZoom 조합인데, 몇 번을 조정해도 "카메라 줌이 몇일 때
// 몇 px가 실제로 몇 미터인지"를 추측해서 맞춰야 했고 계속 틀렸다(오너: "제발 외부 조사를
// 하라니까"). 네이버 공식 문서(android-map-sdk 가이드)를 보면 클러스터링을 쓰는 이유 자체가
// "여러 마커가 겹쳐 나타나 시인성이 떨어지기 때문"이라고 명시돼 있다 — 즉 기준은 "동네
// 단위로 묶기"가 아니라 "마커 아이콘끼리 화면에서 실제로 겹치는가"여야 한다. 그래서 네이티브
// 클러스터링을 버리고, 마커 하나 크기(44px)를 기준으로 직접(웹 메르카토르 투영, 모든
// 슬리피맵 표준 — 네이버도 이 방식이라고 같은 문서에서 확인함) 화면 픽셀 거리를 계산해서
// 겹칠 만큼 가까운 것만 묶는다. 추가로 오너가 지적한 "갯수 2도 숫자로 나오는게 이상하다"를
// 반영해 3개 미만이면 절대 숫자로 안 묶고 그냥 개별로 다 보여준다.
const CLUSTER_PX = 50
const MIN_CLUSTER_COUNT = 3
const TILE_SIZE = 256

function worldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * Math.pow(2, zoom)
}
function worldY(lat: number, zoom: number): number {
  const sin = Math.sin((lat * Math.PI) / 180)
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
  return y * TILE_SIZE * Math.pow(2, zoom)
}

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

/** 카메라가 멈췄을 때(onCameraIdle)의 중심좌표+줌 — 이 값 기준으로 클러스터를 다시 계산한다.
 *  제스처 도중 계속 재계산하면 무겁고 떨려 보인다 — 네이버 SDK 문서에도 "제스처가 완전히
 *  끝날 때까지는 연속 이동으로 간주돼 이벤트가 발생하지 않는다"고 onCameraIdle 을 이 용도로
 *  쓰라고 나와 있다. */
interface CameraState { lat: number; lng: number; zoom: number }

export default function PlaceMap({ focus, pins, zoom = 15, style, showLocationButton = false, cluster = false, onTapPin, onTapBackground, hideBasePoi = false, compactPins = false, resolveTapScreen = false }: Props) {
  const ref = useRef<any>(null)
  const [camera, setCamera] = useState<CameraState>({ lat: focus.lat, lng: focus.lng, zoom })
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    ref.current?.animateCameraTo?.({ latitude: focus.lat, longitude: focus.lng, zoom })
    setCamera({ lat: focus.lat, lng: focus.lng, zoom })
  }, [focus.lat, focus.lng, zoom])

  // 클러스터 그룹 계산 — 활성(주인공) 핀은 제외, 나머지를 화면 픽셀 거리로 묶는다.
  const { groups, singles } = useMemo(() => {
    if (!cluster || !size.width) return { groups: [] as { id: string; lat: number; lng: number; count: number }[], singles: pins.filter((p) => !p.active) }
    const rest = pins.filter((p) => !p.active)
    const cx = worldX(camera.lng, camera.zoom)
    const cy = worldY(camera.lat, camera.zoom)
    const points = rest.map((p) => ({
      pin: p,
      x: size.width / 2 + (worldX(p.lng, camera.zoom) - cx),
      y: size.height / 2 + (worldY(p.lat, camera.zoom) - cy),
    }))
    const used = new Array(points.length).fill(false)
    const rawGroups: (typeof points)[] = []
    for (let i = 0; i < points.length; i++) {
      if (used[i]) continue
      const g = [points[i]]
      used[i] = true
      for (let j = i + 1; j < points.length; j++) {
        if (used[j]) continue
        const dx = points[j].x - points[i].x
        const dy = points[j].y - points[i].y
        if (Math.sqrt(dx * dx + dy * dy) <= CLUSTER_PX) { g.push(points[j]); used[j] = true }
      }
      rawGroups.push(g)
    }
    const bigGroups = rawGroups
      .filter((g) => g.length >= MIN_CLUSTER_COUNT)
      .map((g) => ({
        id: `cl-${g.map((m) => m.pin.id).join('-')}`,
        lat: g.reduce((s, m) => s + m.pin.lat, 0) / g.length,
        lng: g.reduce((s, m) => s + m.pin.lng, 0) / g.length,
        count: g.length,
      }))
    const singlePins = rawGroups.filter((g) => g.length < MIN_CLUSTER_COUNT).flatMap((g) => g.map((m) => m.pin))
    return { groups: bigGroups, singles: singlePins }
  }, [cluster, pins, camera, size])

  if (!NaverMapView) return null

  const activePin = pins.find((p) => p.active)
  const individualPins = cluster ? [...(activePin ? [activePin] : []), ...singles] : pins

  return (
    <View style={style} onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
    <NaverMapView
      ref={ref}
      style={{ flex: 1 }}
      initialCamera={{ latitude: focus.lat, longitude: focus.lng, zoom }}
      isShowLocationButton={showLocationButton}
      isShowZoomControls={cluster}
      isShowScaleBar={false}
      symbolScale={hideBasePoi ? 0 : 1}
      onCameraIdle={cluster ? (e: { latitude: number; longitude: number; zoom: number }) => setCamera({ lat: e.latitude, lng: e.longitude, zoom: e.zoom }) : undefined}
      onTapMap={onTapBackground}
    >
      {/* 클러스터 배지 — 3개 이상 겹칠 때만. 직접 그린 원형 뱃지(숫자) + 탭하면 그 지점으로 확대. */}
      {groups.map((g) => (
        <NaverMapMarkerOverlay
          key={g.id}
          latitude={g.lat}
          longitude={g.lng}
          width={52}
          height={52}
          onTap={() => ref.current?.animateCameraTo?.({ latitude: g.lat, longitude: g.lng, zoom: camera.zoom + 3 })}
        >
          <View style={{
            width: 52, height: 52, borderRadius: 26, backgroundColor: '#FF9F43',
            alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff',
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
          }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>{g.count}</Text>
          </View>
        </NaverMapMarkerOverlay>
      ))}

      {/* 개별 마커 — 히어로에선 전부, 지도탭에선 선택된 매장 + 3개 미만이라 안 뭉친 매장들. */}
      {individualPins.map((p) => {
        const size2 = compactPins ? (p.active ? 24 : p.selected ? 20 : 12) : p.active ? 62 : 44
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
            width={size2}
            height={size2}
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
    </View>
  )
}
