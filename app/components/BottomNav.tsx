import React, { useEffect, useMemo } from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { useThemeStore } from '@/stores/themeStore'
import type { AppColors } from '@/constants/colors'
import { NEW_TABS_ENABLED } from '@/constants/features'
import { saveTabRoute, getTabRoute } from '@/lib/tabMemory'
import { HeartIcon, GroupIcon, ChatIcon, CocktailIcon, UserCircleIcon, EventPhotoIcon, type IconProps } from '@/components/TabIcons'

/**
 * 하단 5탭 내비게이션(2026-08-21) — 소개팅·소셜링·[커뮤니티]·혼술바·MY.
 * 커뮤니티가 본체(매일 오는 곳)라 가운데에 두고 바 윗선 위로 튀어나오게 강조한다.
 * 이름표는 없이 아이콘만 쓴다(2026-08-26 오너 지시).
 *
 * ⚠️(2026-08-26) Ionicons 단색 아이콘이 "촌스럽고 AI 만든 티 난다"는 지적을 받아
 *    Streamline "Flex color"(2톤 컬러) 세트로 교체했다 — components/TabIcons.tsx 참고.
 *    그 파일 주석에 적힌 CC BY 출처표기 의무를 반드시 유지할 것.
 *    예전엔 가운데를 핑크 원형 배경 버튼으로 감쌌는데, 오너 지시로 원형을 없애고
 *    아이콘만 키워서(44px) 바 윗선 위로 14px 올리는 방식으로 바꿨다.
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안 아무것도 그리지 않는다 — 운영 앱은 지금 그대로.
 *    완성 후 플래그를 켜고 새 빌드+심사로 전환한다. constants/features.ts 참고.
 *
 * 전환은 router.replace(지금 소개팅↔커뮤니티가 쓰는 방식 그대로). 스와이프 전환은 없앤다.
 */
type TabKey = 'event' | 'socialing' | 'board' | 'honsul' | 'my'

type IconComp = (p: IconProps) => React.JSX.Element

/** 5개 탭 전부(가운데 커뮤니티 포함) — 순서가 곧 화면 배치 순서다. */
const TABS: { key: TabKey; label: string; route: string; Icon: IconComp }[] = [
  { key: 'event',     label: '소개팅',   route: '/',          Icon: EventPhotoIcon },
  { key: 'socialing', label: '소셜링',   route: '/socialing', Icon: GroupIcon },
  { key: 'board',     label: '커뮤니티', route: '/board',     Icon: ChatIcon },
  { key: 'honsul',    label: '혼술바',   route: '/honsul',    Icon: CocktailIcon },
  { key: 'my',        label: 'MY',       route: '/my',        Icon: UserCircleIcon },
]

/** 아이콘 크기 — 가운데(커뮤니티)만 크게, 그리고 바 윗선 위로 올린다. */
const ICON = 34
const CENTER_ICON = 54
/**
 * 커뮤니티 아이콘이 바 윗선 위로 올라오는 높이 = 위쪽 투명 여백의 높이이기도 하다.
 * ⚠️ 이 값 자체가 "윗선 위로 나온 양"은 아니다. 아이콘은 바 안에서 세로 가운데
 * 정렬되므로, 원래도 위아래로 (CENTER_ICON-BAR_H)/2 만큼 삐져나와 있다
 * (52 아이콘 / 50 바 → 위로 1). 실제 노출량 = 그 값 + CENTER_LIFT.
 * 20 으로 뒀더니 아이콘 절반이 올라가 보였다(오너 지적) — 살짝만 걸치게 낮춘다.
 */
const CENTER_LIFT = 8
/** 바(색이 칠해지는 부분)의 높이. 56 → 50 으로 다시 낮췄다(2026-08-31 오너 지시). */
const BAR_H = 50

const CANONICAL_ROUTE: Record<TabKey, string> = {
  event: '/', socialing: '/socialing', honsul: '/honsul', my: '/my', board: '/board',
}

/**
 * route(각 화면이 넘겨주는 자기 자신의 실제 경로, 예: `/event/${id}`) — 예전엔 여기서
 * usePathname() 으로 "지금 경로"를 알아내 저장했는데, 화면 전환 애니메이션 도중에는
 * 옛 화면·새 화면이 잠깐 같이 떠 있을 수 있어 pathname 이 엉뚱한 화면의 것으로 잘못
 * 저장되는 경쟁 상태가 있었다(2026-08-25 오너 확인: "소개팅을 눌러도 소셜링만 눌러진다",
 * "MY 눌러도 혼술바가 눌러진다" — 라우터 타이밍에 좌우되는 값이라 재현이 들쭉날쭉했다).
 * 대신 각 화면이 자기 id 로 직접 만든, 라우터 타이밍과 무관한 고정 문자열을 넘기게 한다.
 */
export default function BottomNav({ current, route }: { current: TabKey; route?: string }) {
  const colors = useColors()
  const isDark = useThemeStore((s) => s.isDark)
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const myRoute = route ?? CANONICAL_ROUTE[current]

  // 이 화면이 지금 자기 탭 구역에서 "마지막으로 보던 화면"이 된다 — 상세페이지도 포함.
  // 나중에 다른 탭 갔다가 이 탭으로 돌아오면 목록이 아니라 여기로 돌아온다.
  useEffect(() => {
    if (NEW_TABS_ENABLED) saveTabRoute(current, myRoute)
  }, [current, myRoute])

  // 플래그가 꺼져 있으면 렌더 자체를 안 한다 — 운영 앱에 영향 0.
  if (!NEW_TABS_ENABLED) return null

  const go = (key: TabKey, route: string, active: boolean) => {
    if (active) return
    router.replace((getTabRoute(key) ?? route) as never)
  }

  // 선택=핑크 2톤 / 비선택=회색 2톤. Flex color 는 아이콘마다 선(진한 톤)과 면(연한 톤)이
  // 나뉘어 있어서 색 두 개를 넘겨야 한다. 다크모드에선 연한 톤을 그대로 쓰면 눈이 아파
  // 어두운 배경에 맞는 값을 따로 준다.
  const tone = (on: boolean) => on
    ? { stroke: colors.primary, fill: isDark ? '#5A2A3C' : '#FFD9E6' }
    : { stroke: colors.textTertiary, fill: isDark ? '#2A2A31' : '#E9E9F0' }

  // 화면에 이름이 안 보이는 대신 스크린리더가 읽을 수 있게 accessibilityLabel 로 이름을
  // 남긴다(빼먹으면 시각장애인이 탭을 구분하지 못한다).
  const renderTab = (t: typeof TABS[number]) => {
    const on = t.key === current
    const center = t.key === 'board'
    const { stroke, fill } = tone(on)
    return (
      <TouchableOpacity
        key={t.key} style={styles.tab} activeOpacity={0.7}
        onPress={() => go(t.key, t.route, on)}
        accessibilityRole="tab" accessibilityLabel={t.label}
        accessibilityState={{ selected: on }}
      >
        <View style={center ? styles.centerLift : undefined}>
          <t.Icon size={center ? CENTER_ICON : ICON} stroke={stroke} fill={fill} />
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      {/* 바 배경은 아래쪽(BAR_H)에만 깔고, 그 위 CENTER_LIFT 만큼은 투명하게 비워둔다.
          커뮤니티 아이콘은 그 투명 영역으로 올라오므로 "윗선 위로 튀어나온" 모양이 되면서도
          부모 밖으로 나가지 않는다 — 안드로이드는 부모 밖 자식을 잘라버려서(overflow 무시)
          밖으로 밀어내는 방식은 실기기에서 안 먹혔다(2026-08-27 실기기 확인). */}
      <View style={[styles.barBg, { bottom: insets.bottom }]} pointerEvents="none" />
      {TABS.map(renderTab)}
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    // 바깥 컨테이너는 배경이 없다(투명). 위쪽 CENTER_LIFT 만큼이 커뮤니티 아이콘이
    // 올라올 자리이고, 실제 바 색은 아래 barBg 가 칠한다.
    wrap: {
      flexDirection: 'row', alignItems: 'flex-end',
      paddingHorizontal: 4,
      // 위쪽 CENTER_LIFT 만큼은 커뮤니티 아이콘이 올라올 투명 자리다. 그런데 이게
      // 레이아웃 높이로 잡히면 바 윗선 위에 빈 띠가 하나 생겨 화면이 그만큼 밀린다
      // (2026-08-31 오너 지적: "왜 탭바 선 위로 공간이 붙어 있냐").
      // 같은 크기의 음수 마진으로 그 높이를 되돌린다 → 자리는 유지되지만(안드로이드
      // 잘림 방지) 위 화면을 밀지 않고 그 위에 겹쳐 뜬다. 투명이라 가리는 것도 없다.
      paddingTop: CENTER_LIFT,
      marginTop: -CENTER_LIFT,
    },
    // 실제로 색이 칠해지는 바. 좌우 끝까지, 아래는 안전영역 위까지.
    barBg: {
      position: 'absolute', left: 0, right: 0, height: BAR_H,
      backgroundColor: colors.background,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    tab: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      height: BAR_H,
    },
    // 가운데(커뮤니티)만 위로 끌어올린다 — 위에 비워둔 투명 여백 안으로 들어간다.
    centerLift: { transform: [{ translateY: -CENTER_LIFT }] },
  })
}
