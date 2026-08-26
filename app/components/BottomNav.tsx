import React, { useEffect, useMemo } from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { useThemeStore } from '@/stores/themeStore'
import type { AppColors } from '@/constants/colors'
import { NEW_TABS_ENABLED } from '@/constants/features'
import { saveTabRoute, getTabRoute } from '@/lib/tabMemory'
import { HeartIcon, GroupIcon, ChatIcon, CocktailIcon, UserCircleIcon, type IconProps } from '@/components/TabIcons'

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
  { key: 'event',     label: '소개팅',   route: '/',          Icon: HeartIcon },
  { key: 'socialing', label: '소셜링',   route: '/socialing', Icon: GroupIcon },
  { key: 'board',     label: '커뮤니티', route: '/board',     Icon: ChatIcon },
  { key: 'honsul',    label: '혼술바',   route: '/honsul',    Icon: CocktailIcon },
  { key: 'my',        label: 'MY',       route: '/my',        Icon: UserCircleIcon },
]

/** 아이콘 크기 — 가운데(커뮤니티)만 크게, 그리고 바 윗선 위로 올린다(오너 선택: 44/14). */
const ICON = 28
const CENTER_ICON = 44
const CENTER_LIFT = 14

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
        {/* 가운데만 transform 으로 끌어올린다 — margin 을 쓰면 바 높이가 같이 늘어나
            아이콘이 바 안에 갇힌다(시안 만들며 실제로 겪은 문제). */}
        <View style={center ? styles.centerLift : undefined}>
          <t.Icon size={center ? CENTER_ICON : ICON} stroke={stroke} fill={fill} />
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]}>
      {TABS.map(renderTab)}
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    // ⚠️ overflow 를 자르면 안 된다 — 가운데 커뮤니티 아이콘이 이 바 위로 튀어나온다.
    wrap: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.background,
      borderTopWidth: 1, borderTopColor: colors.divider,
      paddingHorizontal: 4,
      overflow: 'visible',
    },
    // 이름표를 뺀 뒤에도 바 높이가 확 줄지 않게 세로 패딩을 유지한다(아이콘 28 + 패딩 26 ≈ 54).
    tab: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingTop: 14, paddingBottom: 12,
      overflow: 'visible',
    },
    // 가운데(커뮤니티)만 위로 끌어올린다. translateY 는 레이아웃 높이에 영향이 없어
    // 바 높이가 안 늘어나고 아이콘만 윗선 밖으로 나간다.
    centerLift: { transform: [{ translateY: -CENTER_LIFT }] },
  })
}
